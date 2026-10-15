import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://eefhkfhccqbxvehzdljz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZmhrZmhjY3FieHZlaHpkbGp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMzQ5MzEsImV4cCI6MjEwMDcxMDkzMX0.2PR60mHhqNbt5Xfed05YH-fo56N1-0kTEXW5L_HQHgU';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ACCESSIBLE_TIERS = {
    'USER': ['USER'],
    'CONTRACTOR': ['USER', 'CONTRACTOR'],
    'COMMUNICATIONS': ['USER', 'CONTRACTOR', 'COMMUNICATIONS'],
    'RESEARCH': ['USER', 'CONTRACTOR', 'RESEARCH'],
    'SECURITY': ['USER', 'CONTRACTOR', 'COMMUNICATIONS', 'RESEARCH', 'SECURITY'],
    'ADMIN': ['USER', 'CONTRACTOR', 'COMMUNICATIONS', 'RESEARCH', 'SECURITY', 'ADMIN']
};

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

// Clean backend-driven discrepancy logger via RPC
export async function logDiscrepancy(supabaseClient, player, eventType, details = '') {
    if (!supabaseClient) return;

    try {
        await supabaseClient.rpc('log_discrepancy', {
            badge_id: player?.badge_id || player?.activeBadge || null,
            operator_name: player?.username || null,
            event_type: eventType,
            details: String(details).substring(0, 500)
        });
    } catch (err) {
        console.error('Failed to log event via RPC:', err);
    }
}

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
        return allFiles;
    }

    const cleanDir = directory.replace(/^\/|\/$/g, '').toLowerCase();
    
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

    await logDiscrepancy(supabase, activePlayer, 'SESSION_START', `Node-07 terminal session initiated for ${activePlayer.username}.`);
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
        printLine(`Directory listing for ${currentDirectory}:`, 'sys-info');
        const records = await getClearedFiles(currentDirectory);

        if (!records || records.length === 0) {
            printLine('  (no authorized files or subdirectories found)', 'sys-err');
            return;
        }

        records.forEach(file => {
            printLine(`  [FILE] ${file.record_file_name || file.name} (${file.path || currentDirectory})`, 'txt-file');
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
            (r.path && r.path.toLowerCase() === arg1.toLowerCase())
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

        await supabase.rpc('update_user_clearance', {
            target_user_id: activePlayer.id,
            new_clearance: 'USER'
        });

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
            await logDiscrepancy(supabase, activePlayer, 'FAILED_LOGIN', `Failed login attempt using badge ID: ${arg1}`);
            return;
        }
    
        printLine(`[AUTH_SUCCESS] Principal verified: ${targetPersona.character_name} (${targetPersona.badge_id})`, 'sys-success');
        printLine(`[TOKEN_EXCHANGE] Elevating session clearance scope to: [${targetPersona.clearance}]...`, 'sys-info');
    
        // Safely update database clearance if user ID is present in the active session
        if (activePlayer.id) {
            await supabase.rpc('update_user_clearance', {
                target_user_id: activePlayer.id,
                new_clearance: targetPersona.clearance
            });
        }
    
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
        await supabase.rpc('update_user_clearance', {
            target_user_id: activePlayer.id,
            new_clearance: 'USER'
        });

        await logDiscrepancy(supabase, activePlayer, 'LOGOUT', 'Terminal session terminated by operator.');

        sessionStorage.removeItem('trb_player_session');
        printLine('Terminating session connection...', 'sys-info');
        setTimeout(() => window.location.href = 'index.html', 500);
        return;
    }

    printLine(`Command '${cmd}' unrecognized. Type 'help' for command directory.`, 'sys-err');
}

export async function handleLogin(usernameIn, badgeIn) {
    if (!usernameIn || !badgeIn) {
        return { success: false, message: 'SEC_ERROR: Missing username or badge ID parameters.', color: '#ef4444' };
    }

    try {
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

        await supabase.rpc('update_user_clearance', {
            target_user_id: user.id,
            new_clearance: 'USER'
        });

        sessionStorage.setItem('trb_player_session', JSON.stringify({
            id: user.id,
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