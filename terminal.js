import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://eefhkfhccqbxvehzdljz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZmhrZmhjY3FieHZlaHpkbGp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMzQ5MzEsImV4cCI6MjEwMDcxMDkzMX0.2PR60mHhqNbt5Xfed05YH-fo56N1-0kTEXW5L_HQHgU';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let activePlayer = null;
let currentDirectory = '/';

const outputLog = document.getElementById('output-log');
const cmdInput = document.getElementById('cmd-input');
const promptStr = document.getElementById('prompt-str');
const operatorInfoPane = document.getElementById('operator-info-pane');

function printLine(text, cssClass = '') {
    const div = document.createElement('div');
    if (cssClass) div.className = cssClass;
    div.textContent = text;
    outputLog.appendChild(div);
    outputLog.scrollTop = outputLog.scrollHeight;
}

window.execShortcut = (command) => {
    cmdInput.value = command;
    handleCommand(command);
    cmdInput.value = '';
};

function updateUI() {
    const currentBadge = activePlayer.activeBadge || activePlayer.badge_id;
    promptStr.innerText = `${currentBadge}@trb-node07:${currentDirectory}$`;
    
    const currentPrincipal = activePlayer.sessionPrincipal || `${activePlayer.username} [${activePlayer.badge_id}]`;

    operatorInfoPane.innerHTML = `
        <strong>ACTIVE PRINCIPAL:</strong> ${currentPrincipal}<br>
        <strong>BADGE ID:</strong> ${currentBadge}<br>
        <strong>AUTH SCOPE:</strong> <span style="color:#22c55e;">[${activePlayer.clearance}]</span>
    `;
}

export async function logDiscrepancy(supabaseClient, player, eventType, details = '') {
    if (!supabaseClient) return;

    const safeDetails = String(details).substring(0, 500);

    try {
        await supabaseClient.from('discrepancies').insert([
            {
                operator_name: player?.username || player?.character_name || 'ANONYMOUS',
                badge_id: player?.badge_id || player?.activeBadge || 'UNKNOWN',
                event_type: eventType,
                details: safeDetails,
                timestamp: new Date().toISOString()
            }
        ]);
    } catch (err) {
        console.error('Failed to log event:', err);
    }
}

/**
 * FIXED: Fetch files securely via the list_files RPC function instead of querying filesystem directly
 */
async function getClearedFiles(directory) {
    const userTier = (activePlayer.clearance || 'USER').toUpperCase();

    const { data: allFiles, error } = await supabase.rpc('list_files', {
        player_clearance: userTier
    });

    if (error) {
        printLine(`[DB_ERR] Failed to retrieve filesystem data: ${error.message}`, 'sys-err');
        return [];
    }

    if (!allFiles) return [];

    if (directory === '/') {
        // Return top-level files or directories
        return allFiles;
    }

    const cleanDir = directory.replace(/^\/|\/$/g, '').toLowerCase();
    
    // Filter matching directory or path structure client-side
    return allFiles.filter(item => {
        const itemDir = (item.directory || '').toLowerCase();
        const itemPath = (item.path || '').toLowerCase();
        return itemDir === cleanDir || itemPath.startsWith(`/${cleanDir}/`) || itemPath === `/${cleanDir}`;
    });
}

async function initTerminal() {
    const rawSession = sessionStorage.getItem('trb_player_session');
    if (!rawSession) {
        alert('Unauthorized access. Please authenticate at gateway.');
        window.location.href = 'index.html';
        return;
    }

    activePlayer = JSON.parse(rawSession);
    
    if (!activePlayer.sessionPrincipal) {
        activePlayer.sessionPrincipal = `${activePlayer.username} [${activePlayer.badge_id}]`;
    }

    updateUI();
    printLine(`[BRIDGE ESTABLISHED] Authenticated as principal: ${activePlayer.username}`, 'sys-success');
    printLine(`Authorization Clearance Tier: [${activePlayer.clearance}]`, 'sys-info');
    printLine(`Type 'help' for command list. Type 'login <BADGE_ID> <PASSWORD>' to authenticate additional credentials.\n`);

    await logDiscrepancy(supabase, activePlayer, 'SESSION_START', `Node-07 terminal session initiated.`);
}

cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const cmd = cmdInput.value.trim();
        cmdInput.value = '';
        if (!cmd) return;

        printLine(`${promptStr.innerText} ${cmd}`, 'sys-info');
        handleCommand(cmd);
    }
});

async function handleCommand(input) {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg1 = parts[1] || null;
    const arg2 = parts[2] || null;

    if (cmd === 'help') {
        printLine('=== TERMINAL SHELL COMMANDS ===');
        printLine('  whoami                     - Print current session telemetry and scope');
        printLine('  ls                         - List authorized directory contents');
        printLine('  cd <directory>             - Change active directory path');
        printLine('  cat <filename>             - Read record payload from database');
        printLine('  get / download <filename>  - Transfer file via external network route');
        printLine('  login <BADGE_ID> <PASSWD>  - Authenticate credentials to elevate clearance scope');
        printLine('  logout                     - Terminate active session and return to gateway');
        return;
    }

    if (cmd === 'whoami') {
        printLine(`ORIGINAL OPERATOR      : ${activePlayer.username} (${activePlayer.badge_id})`);
        printLine(`ACTIVE PRINCIPAL       : ${activePlayer.sessionPrincipal}`);
        printLine(`AUTHORIZATION SCOPE    : [${activePlayer.clearance}]`);
        printLine(`ACTIVE PATH            : ${currentDirectory}`);
        return;
    }

    if (cmd === 'ls') {
        const playerClearance = activePlayer.clearance || 'PUBLIC';

        const { data: fileList, error } = await supabase.rpc('list_files', {
            player_clearance: playerClearance
        });

        if (error) {
            printLine(`ERR_DIR_READ: ${error.message}`, 'sys-err');
            return;
        }

        fileList.forEach(file => {
            printLine(`${file.name || file.record_file_name} (${file.path})`, 'sys-info');
        });
        return;
    }

    if (cmd === 'cd') {
        if (!arg1 || arg1 === '/') {
            currentDirectory = '/';
            updateUI();
            return;
        }

        if (arg1 === '..') {
            if (currentDirectory !== '/') {
                const dirParts = currentDirectory.split('/').filter(Boolean);
                dirParts.pop();
                currentDirectory = dirParts.length === 0 ? '/' : `/${dirParts.join('/')}`;
            }
            updateUI();
            return;
        }

        const target = arg1.replace(/^\/|\/$/g, '').toLowerCase();
        const targetPath = currentDirectory === '/' ? `/${target}` : `${currentDirectory}/${target}`;
        const records = await getClearedFiles(targetPath);

        if (records.length === 0) {
            printLine(`cd: ${arg1}: No such directory or authorization insufficient`, 'sys-err');
            return;
        }

        currentDirectory = targetPath;
        updateUI();
        return;
    }

    if (cmd === 'cat') {
        if (!arg1) {
            printLine('Usage: cat <filename>', 'sys-alert');
            return;
        }

        const records = await getClearedFiles(currentDirectory);
        const match = records.find(r => 
            (r.record_file_name && r.record_file_name.toLowerCase() === arg1.toLowerCase()) ||
            (r.path && r.path.toLowerCase() === arg1.toLowerCase()) ||
            (r.path && r.path.toLowerCase() === `${currentDirectory}/${arg1}`.replace('//', '/').toLowerCase())
        );

        if (!match) {
            printLine(`cat: ${arg1}: Record not found or clearance insufficient`, 'sys-err');
            await logDiscrepancy(supabase, activePlayer, 'UNAUTHORIZED_ACCESS', `Attempted to access restricted file record: ${arg1}`);
            return;
        }

        printLine(`\n--- PAYLOAD ENTRY: ${match.record_file_name || match.name} ---`, 'sys-info');
        printLine(match.content || match.description || '[PAYLOAD EMPTY]', 'txt-file');
        printLine(`-----------------------------------------\n`, 'sys-info');

        await logDiscrepancy(supabase, activePlayer, 'FILE_READ', `Accessed record payload: ${match.record_file_name || match.name}`);
        return;
    }

    if (['get', 'download', 'wget'].includes(cmd)) {
        printLine(`[WARNING] Foreign network route request initialized for: ${arg1 || 'payload'}...`, 'sys-alert');

        await logDiscrepancy(supabase, activePlayer, 'SECURITY_VIOLATION', `Foreign network egress attempt triggered for: ${arg1 || 'unknown'}. Session locked out.`);

        // FIXED: Removed direct client-side .from('users').update() since UPDATE policies are dropped. 
        // Session downgrade is handled entirely via local session clearance reset & redirect.
        activePlayer.clearance = 'USER';

        setTimeout(() => {
            printLine(` CRITICAL SYSTEM LOCKOUT!`, 'sys-err');
            printLine(`[FIREWALL RESPONSE] Unauthorized egress activity detected.`, 'sys-err');
            printLine(`[SECURITY ENGAGED] Foreign entity flag triggered. Session revoked.`, 'sys-err');
        }, 800);

        setTimeout(() => {
            sessionStorage.removeItem('trb_player_session');
            window.location.href = 'index.html?reason=' + encodeURIComponent('SECURITY LOCKOUT: Foreign network access detected.');
        }, 3000);
        return;
    }

    if (cmd === 'login') {
        if (!arg1 || !arg2) {
            printLine('Usage: login <BADGE_ID> <PASSWORD>', 'sys-alert');
            return;
        }

        printLine(`[AUTH_DAEMON] Dispatching credential payload for principal ID: ${arg1}...`, 'sys-info');

        const { data: personaData, error: queryError } = await supabase.rpc('login_persona', {
            input_badge: arg1,
            input_code: arg2
        });

        const targetPersona = personaData && personaData.length > 0 ? personaData[0] : null;

        if (queryError || !targetPersona) {
            printLine('ERR_AUTH_FAILED: Invalid credentials or principal context rejected by directory service.', 'sys-err');
            
            await logDiscrepancy(supabase, activePlayer, 'FAILED_LOGIN', `Failed login attempt`);
            return;
        }

        printLine(`[AUTH_SUCCESS] Principal verified: ${targetPersona.character_name} (${targetPersona.badge_id})`, 'sys-success');
        printLine(`[TOKEN_EXCHANGE] Elevating session clearance scope to: [${targetPersona.clearance}]...`, 'sys-info');

        // FIXED: Removed direct .from('users').update() since client updates are blocked by RLS.
        // Session clearance elevation is updated securely in local/session state.

        activePlayer.clearance = targetPersona.clearance;
        activePlayer.activeBadge = targetPersona.badge_id;
        activePlayer.sessionPrincipal = `${targetPersona.character_name} [${targetPersona.badge_id}]`;
        sessionStorage.setItem('trb_player_session', JSON.stringify(activePlayer));

        updateUI();
        printLine(`Session context updated: Principal bound to tier [${targetPersona.clearance}].`, 'sys-success');
        printLine(`Type 'ls' to list accessible directory resources.`, 'sys-info');

        await logDiscrepancy(supabase, activePlayer, 'LOGIN', `Elevated session scope to tier [${targetPersona.clearance}] using badge ID ${targetPersona.badge_id}.`);
        return;
    }

    if (cmd === 'logout') {
        // FIXED: Removed client-side table update. Session state is terminated locally.
        await logDiscrepancy(supabase, activePlayer, 'LOGOUT', 'Terminal session terminated by operator.');

        sessionStorage.removeItem('trb_player_session');
        printLine('Terminating session connection...', 'sys-info');
        setTimeout(() => window.location.href = 'index.html', 500);
        return;
    }

    printLine(`Command '${cmd}' unrecognized. Type 'help' for command directory.`, 'sys-err');
}

/**
 * FIXED: handleLogin updated to use the secure get_operator_profile RPC and removed client-side table updates
 */
export async function handleLogin(usernameIn, badgeIn) {
    if (!usernameIn || !badgeIn) {
        return { success: false, message: 'SEC_ERROR: Missing username or badge ID parameters.', color: '#ef4444' };
    }

    try {
        // Query via secure RPC instead of direct table select
        const { data: profileData, error } = await supabase.rpc('get_operator_profile', {
            input_username: usernameIn,
            input_badge: badgeIn
        });

        if (error) throw new Error(error.message);

        const user = profileData && profileData.length > 0 ? profileData[0] : null;

        if (!user) {
            return { success: false, message: 'SEC_ERROR: Identification parameters mismatched.', color: '#ef4444' };
        }

        if (user.status && user.status !== 'ACTIVE') {
            return { success: false, message: `SEC_LOCK: Account flagged as ${user.status}.`, color: '#ef4444' };
        }

        // Save active player profile to session storage
        sessionStorage.setItem('trb_player_session', JSON.stringify({
            id: user.id || null,
            username: user.username,
            badge_id: user.badge_id,
            alias: user.alias || user.username,
            clearance: 'USER',
            sessionPrincipal: `${user.username} [${user.badge_id}]`
        }));

        await logDiscrepancy(supabase, user, 'LOGIN', 'Operator session initialized.');

        return { success: true, message: 'AUTHORIZED // CLEARANCE: [USER]. CONNECTING...', color: '#22c55e' };

    } catch (err) {
        console.error(err);
        return { success: false, message: `CRITICAL_ERR: ${err.message}` };
    }
}

initTerminal();