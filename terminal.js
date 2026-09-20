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

// Clean backend-driven discrepancy logger
export async function logDiscrepancy(supabaseClient, player, eventType, details = '') {
    if (!supabaseClient) return;

    try {
        // We only pass the minimal handle (like badge_id or username) 
        // and the database trigger will handle the alias lookup and column cleanup.
        const payload = {
            badge_id: player?.badge_id || player?.activeBadge || null,
            operator_name: player?.username || null,
            event_type: eventType,
            details: details,
            timestamp: new Date().toISOString()
        };

        const { error } = await supabaseClient
            .from('discrepancies')
            .insert([payload]);

        if (error) {
            console.error('Failed to log discrepancy on backend:', error.message);
        }
    } catch (err) {
        console.error('Failed to log event:', err);
    }
}

// Fetch files from Supabase matching the directory and cleared access levels
async function getClearedFiles(directory) {
    const userTier = (activePlayer.clearance || 'USER').toUpperCase();
    const allowedClearances = ACCESSIBLE_TIERS[userTier] || ['USER'];

    let query = supabase
        .from('filesystem')
        .select('*')
        .in('access_clearance', allowedClearances);

    if (directory !== '/') {
        const cleanDir = directory.replace(/^\/|\/$/g, '').toLowerCase();
        query = query.or(`directory.ilike.${cleanDir},path.ilike./${cleanDir}/%`);
    }

    const { data, error } = await query;
    if (error) {
        printLine(`[DB_ERR] Failed to retrieve filesystem data: ${error.message}`, 'sys-err');
        return [];
    }
    return data || [];
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

    // Log terminal session initialization
    await logDiscrepancy(supabase, activePlayer, 'SESSION_START', `Node-07 terminal session initiated for.`);
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

        const subdirs = new Set();
        const files = [];

        records.forEach(item => {
            const pathParts = item.path.split('/').filter(Boolean);
            if (currentDirectory === '/') {
                if (pathParts.length > 1) {
                    subdirs.add(pathParts[0]);
                } else {
                    files.push(item);
                }
            } else {
                const cleanCurrent = currentDirectory.replace(/^\/|\/$/g, '');
                if (item.path.startsWith(`/${cleanCurrent}/`)) {
                    const remaining = item.path.replace(`/${cleanCurrent}/`, '').split('/');
                    if (remaining.length > 1) {
                        subdirs.add(remaining[0]);
                    } else {
                        files.push(item);
                    }
                }
            }
        });

        subdirs.forEach(dir => printLine(`  [DIR]  ${dir}/`, 'sys-info'));
        files.forEach(file => printLine(`  [FILE] ${file.record_file_name}`, 'txt-file'));

        if (subdirs.size === 0 && files.length === 0) {
            printLine('  (no authorized files or subdirectories found)', 'sys-err');
        }
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
            r.record_file_name.toLowerCase() === arg1.toLowerCase() ||
            r.path.toLowerCase() === arg1.toLowerCase() ||
            r.path.toLowerCase() === `${currentDirectory}/${arg1}`.replace('//', '/').toLowerCase()
        );

        if (!match) {
            printLine(`cat: ${arg1}: Record not found or clearance insufficient`, 'sys-err');
            // Log failed or unauthorized file inspection attempt
            await logDiscrepancy(supabase, activePlayer, 'UNAUTHORIZED_ACCESS', `Attempted to access restricted file record: ${arg1}`);
            return;
        }

        printLine(`\n--- PAYLOAD ENTRY: ${match.record_file_name} ---`, 'sys-info');
        printLine(match.content || match.description || '[PAYLOAD EMPTY]', 'txt-file');
        printLine(`-----------------------------------------\n`, 'sys-info');

        // Log successful file read
        await logDiscrepancy(supabase, activePlayer, 'FILE_READ', `Accessed record payload: ${match.record_file_name}`);
        return;
    }

    if (['get', 'download', 'wget'].includes(cmd)) {
        printLine(`[WARNING] Foreign network route request initialized for: ${arg1 || 'payload'}...`, 'sys-alert');

        // Log critical security egress violation
        await logDiscrepancy(supabase, activePlayer, 'SECURITY_VIOLATION', `Foreign network egress attempt triggered for: ${arg1 || 'unknown'}. Session locked out.`);

        await supabase
            .from('users')
            .update({ clearance: 'USER' })
            .eq('id', activePlayer.id);

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
    
        const { data: targetPersona, error: queryError } = await supabase
            .from('fictional_users')
            .select('*')
            .eq('badge_id', arg1)
            .eq('password', arg2)
            .maybeSingle();
    
        if (queryError || !targetPersona) {
            printLine('ERR_AUTH_FAILED: Invalid credentials or principal context rejected by directory service.', 'sys-err');
            
            // Log failed credential login attempt
            await logDiscrepancy(supabase, activePlayer, 'FAILED_LOGIN', `Failed login attempt using badge ID: ${arg1}`);
            return;
        }
    
        printLine(`[AUTH_SUCCESS] Principal verified: ${targetPersona.character_name} (${targetPersona.badge_id})`, 'sys-success');
        printLine(`[TOKEN_EXCHANGE] Elevating session clearance scope to: [${targetPersona.clearance}]...`, 'sys-info');
    
        const { error: dbError } = await supabase
            .from('users')
            .update({ clearance: targetPersona.clearance })
            .eq('id', activePlayer.id);
    
        if (dbError) {
            printLine(`[DB_WARN] Persistent session state override active (${dbError.message}).`, 'sys-alert');
        }
    
        activePlayer.clearance = targetPersona.clearance;
        activePlayer.activeBadge = targetPersona.badge_id;
        activePlayer.sessionPrincipal = `${targetPersona.character_name} [${targetPersona.badge_id}]`;
        sessionStorage.setItem('trb_player_session', JSON.stringify(activePlayer));
    
        updateUI();
        printLine(`Session context updated: Principal bound to tier [${targetPersona.clearance}].`, 'sys-success');
        printLine(`Type 'ls' to list accessible directory resources.`, 'sys-info');

        // Log successful privilege escalation / login
        await logDiscrepancy(supabase, activePlayer, 'LOGIN', `Elevated session scope to tier [${targetPersona.clearance}] using badge ID ${targetPersona.badge_id}.`);
        return;
    }

    if (cmd === 'logout') {
        await supabase
            .from('users')
            .update({ clearance: 'USER' })
            .eq('id', activePlayer.id);

        // Log session logout
        await logDiscrepancy(supabase, activePlayer, 'LOGOUT', 'Terminal session terminated by operator.');

        sessionStorage.removeItem('trb_player_session');
        printLine('Terminating session connection...', 'sys-info');
        setTimeout(() => window.location.href = 'index.html', 500);
        return;
    }

    printLine(`Command '${cmd}' unrecognized. Type 'help' for command directory.`, 'sys-err');
}

// Window unload safety cleanup beacon handler
window.addEventListener('beforeunload', () => {
    if (!activePlayer) return;
    const payload = JSON.stringify({ clearance: 'USER' });
    const url = `${SUPABASE_URL}/rest/v1/users?id=eq.${activePlayer.id}`;
    navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    sessionStorage.removeItem('trb_player_session');
});


export async function handleLogin(usernameIn, badgeIn) {
    if (!usernameIn || !badgeIn) {
        return { success: false, message: 'SEC_ERROR: Missing username or badge ID parameters.', color: '#ef4444' };
    }

    try {
        // 1. Query Supabase users table (including 'alias')
        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, badge_id, clearance, status, alias')
            .eq('username', usernameIn)
            .eq('badge_id', badgeIn)
            .maybeSingle();

        if (error) throw new Error(error.message);

        if (!user) {
            return { success: false, message: 'SEC_ERROR: Identification parameters mismatched.', color: '#ef4444' };
        }

        if (user.status && user.status !== 'ACTIVE') {
            return { success: false, message: `SEC_LOCK: Account flagged as ${user.status}.`, color: '#ef4444' };
        }

        // 2. Automatically reset clearance to 'USER' on every fresh login
        const { error: updateError } = await supabase
            .from('users')
            .update({ 
                clearance: 'USER', 
                last_login: new Date().toISOString() 
            })
            .eq('id', user.id);

        if (updateError) throw new Error(updateError.message);

        // 3. Save active player profile to session storage (including alias)
        sessionStorage.setItem('trb_player_session', JSON.stringify({
            id: user.id,
            username: user.username,
            badge_id: user.badge_id,
            alias: user.alias,
            clearance: 'USER',
            sessionPrincipal: `${user.username} [${user.badge_id}]`
        }));

        // Log successful session entry using the alias
        await logDiscrepancy(supabase, user, 'LOGIN', 'Operator session initialized.');

        return { success: true, message: 'AUTHORIZED // CLEARANCE: [USER]. CONNECTING...', color: '#22c55e' };

    } catch (err) {
        console.error(err);
        return { success: false, message: `CRITICAL_ERR: ${err.message}` };
    }
}

initTerminal();
