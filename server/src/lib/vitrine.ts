import crypto from 'node:crypto';
import { config } from '../config.js';

export interface VitrineSecrets {
  hash: string;
  salt: string;
  iterations: number;
  secret: string;
  access: string;
  days: number;
  pinLength: number;
}

async function publicIp(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return response.ok ? (await response.text()).trim() : null;
  } catch {
    return null;
  }
}

function ipv6Prefix60(ip: string): string | null {
  const groups = ip.split(':');
  if (ip.includes('::') || groups.length !== 8) {
    const [head, tail] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    groups.splice(0, groups.length, ...left, ...Array(8 - left.length - right.length).fill('0'), ...right);
  }
  if (groups.length !== 8) return null;
  return `${groups.slice(0, 4).join(':')}::/60`;
}

/** Règles IP « maison » (accès sans code) : HOME_IPS=auto détecte l'IPv4 publique et le préfixe IPv6 /60 de la Freebox. */
export async function resolveHomeIps(): Promise<string[]> {
  const rules = new Set<string>();
  for (const entry of config.homeIps) {
    if (entry.toLowerCase() !== 'auto') {
      rules.add(entry);
      continue;
    }
    const v4 = await publicIp('https://api.ipify.org');
    if (v4 && /^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) rules.add(v4);
    const v6 = await publicIp('https://api6.ipify.org');
    const prefix = v6 && v6.includes(':') ? ipv6Prefix60(v6) : null;
    if (prefix) rules.add(prefix);
  }
  return [...rules];
}

export function vitrineSecrets(): VitrineSecrets {
  const iterations = 150000;
  const salt = crypto.createHmac('sha256', config.jwtSecret).update('alexflix-vitrine-salt').digest('hex').slice(0, 32);
  const hash = crypto.pbkdf2Sync(config.vitrinePin, salt, iterations, 32, 'sha256').toString('hex');
  const secret = crypto.createHmac('sha256', config.jwtSecret).update(`alexflix-vitrine-cookie|${hash}`).digest('hex');
  const access = crypto.createHmac('sha256', secret).update('alexflix-access-link').digest('hex').slice(0, 40);
  return { hash, salt, iterations, secret, access, days: config.vitrineSessionDays, pinLength: config.vitrinePin.length };
}

export function configPhp(secrets: VitrineSecrets, homeIps: string[]): string {
  const home = homeIps.map((rule) => `'${rule.replace(/[^0-9a-fA-F:./]/g, '')}'`).join(', ');
  return `<?php
// AlexFlix — configuration de la vitrine (générée par npm run deploy, ne pas publier ailleurs)
return [
  'hash' => '${secrets.hash}',
  'salt' => '${secrets.salt}',
  'iterations' => ${secrets.iterations},
  'secret' => '${secrets.secret}',
  'access' => '${secrets.access}',
  'days' => ${secrets.days},
  'pin_length' => ${secrets.pinLength},
  'home' => [${home}],
];
`;
}

export const htaccess = String.raw`# AlexFlix — vitrine privée (générée par npm run deploy)
Options -Indexes
DirectoryIndex gate.php
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteCond %{HTTPS} off
  RewriteCond %{HTTP:X-Forwarded-Proto} !https
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
  RewriteRule ^gate\.php$ - [L]
  RewriteRule ^ gate.php [L,QSA]
</IfModule>
<FilesMatch "^(ap-config\.php|\.ap-attempts\.json|\.ap-state\.json|\.ap-sync\.json)$">
  Require all denied
</FilesMatch>
`;

export const gatePhp = String.raw`<?php
/* AlexFlix — passerelle privée de la vitrine (générée par npm run deploy). */
declare(strict_types=1);

$cfg = require __DIR__ . '/ap-config.php';
$root = realpath(__DIR__);
$cookie = 'ap_vitrine';
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
  || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
  || ((string)($_SERVER['SERVER_PORT'] ?? '') === '443');

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
if ($https) header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header('X-Robots-Tag: noindex, nofollow');

function ap_sign(int $exp, string $secret): string
{
  return hash_hmac('sha256', 'alexflix|' . $exp, $secret);
}

function ap_is_authed(array $cfg, string $cookie): bool
{
  $value = $_COOKIE[$cookie] ?? '';
  if (!is_string($value) || strpos($value, '.') === false) return false;
  [$exp, $sig] = explode('.', $value, 2);
  if (!preg_match('/^\d+$/', $exp) || (int)$exp < time()) return false;
  return hash_equals(ap_sign((int)$exp, $cfg['secret']), $sig);
}

function ap_ip_match(string $ip, string $rule): bool
{
  $parts = explode('/', $rule, 2);
  $net = @inet_pton($parts[0]);
  $addr = @inet_pton($ip);
  if ($net === false || $addr === false || strlen($net) !== strlen($addr)) return false;
  $bits = isset($parts[1]) ? (int)$parts[1] : strlen($net) * 8;
  $bytes = intdiv($bits, 8);
  if (substr($net, 0, $bytes) !== substr($addr, 0, $bytes)) return false;
  $rest = $bits % 8;
  if ($rest === 0) return true;
  $mask = (0xFF << (8 - $rest)) & 0xFF;
  return (ord($net[$bytes]) & $mask) === (ord($addr[$bytes]) & $mask);
}

function ap_is_home(array $cfg): bool
{
  $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  if (stripos($ip, '::ffff:') === 0 && strpos($ip, '.') !== false) $ip = substr($ip, 7);
  foreach (($cfg['home'] ?? []) as $rule) {
    if (ap_ip_match($ip, (string)$rule)) return true;
  }
  return false;
}

function ap_set_cookie(string $name, string $value, int $expires, bool $https): void
{
  setcookie($name, $value, ['expires' => $expires, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
}

const AP_AVATARS = ['bounty', 'red', 'blue', 'yellow', 'green', 'purple', 'pink'];
const AP_COLORS = ['red' => '#e50914', 'blue' => '#2f6fde', 'yellow' => '#f5b301', 'green' => '#1ea35b', 'purple' => '#7b3fe4', 'pink' => '#e0469a'];

function ap_default_state(): array
{
  return ['profiles' => [['id' => 'alex', 'name' => 'Alex', 'avatar' => 'bounty']], 'data' => new stdClass()];
}

function ap_state_file(): string
{
  return __DIR__ . '/.ap-state.json';
}

function ap_state_read(): array
{
  $raw = is_file(ap_state_file()) ? @file_get_contents(ap_state_file()) : false;
  $state = $raw ? json_decode((string)$raw, true) : null;
  if (!is_array($state) || empty($state['profiles']) || !is_array($state['profiles'])) $state = ap_default_state();
  if (!isset($state['data']) || !is_array($state['data'])) $state['data'] = [];
  return $state;
}

function ap_state_update(callable $mutate): array
{
  $handle = fopen(ap_state_file(), 'c+');
  if ($handle === false) {
    http_response_code(500);
    echo '{"error":"Stockage indisponible"}';
    exit;
  }
  flock($handle, LOCK_EX);
  $raw = stream_get_contents($handle);
  $state = $raw ? json_decode((string)$raw, true) : null;
  if (!is_array($state) || empty($state['profiles'])) $state = ap_default_state();
  if (!isset($state['data']) || !is_array($state['data'])) $state['data'] = [];
  $state = $mutate($state);
  ftruncate($handle, 0);
  rewind($handle);
  fwrite($handle, (string)json_encode($state, JSON_UNESCAPED_UNICODE));
  fflush($handle);
  flock($handle, LOCK_UN);
  fclose($handle);
  return $state;
}

function ap_clean_profiles($input): ?array
{
  if (!is_array($input) || count($input) < 1 || count($input) > 5) return null;
  $out = [];
  $ids = [];
  foreach ($input as $profile) {
    if (!is_array($profile)) return null;
    $id = (string)($profile['id'] ?? '');
    $name = trim(preg_replace('/\s+/u', ' ', (string)($profile['name'] ?? '')));
    $avatar = (string)($profile['avatar'] ?? 'red');
    if (!preg_match('/^[a-z0-9-]{1,32}$/', $id) || isset($ids[$id])) return null;
    if ($name === '' || mb_strlen($name) > 20) return null;
    $custom = preg_match('/^custom:([a-f0-9]{16})$/', $avatar, $match) === 1 && is_file(__DIR__ . '/avatars/' . $match[1] . '.jpg');
    $film = preg_match('/^film:([a-z0-9-]+\.jpg)$/', $avatar, $match) === 1 && is_file(__DIR__ . '/images/' . $match[1]);
    if (!$custom && !$film && !in_array($avatar, AP_AVATARS, true)) $avatar = 'red';
    $ids[$id] = true;
    $out[] = ['id' => $id, 'name' => $name, 'avatar' => $avatar, 'kids' => !empty($profile['kids'])];
  }
  return $out;
}

function ap_avatar(string $avatar): string
{
  if ($avatar === 'bounty') return '<img src="/avatar.jpg" alt="" draggable="false">';
  if (preg_match('/^custom:([a-f0-9]{16})$/', $avatar, $match) === 1) return '<img src="/avatars/' . $match[1] . '.jpg" alt="" draggable="false">';
  if (preg_match('/^film:([a-z0-9-]+\.jpg)$/', $avatar, $match) === 1) return '<img src="/images/' . $match[1] . '" alt="" draggable="false" style="object-position:50% 18%">';
  $color = AP_COLORS[$avatar] ?? AP_COLORS['red'];
  return '<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="' . $color . '"/><circle cx="34" cy="40" r="6" fill="#fff"/><circle cx="66" cy="40" r="6" fill="#fff"/><path d="M28 62 Q50 82 72 62" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none"/></svg>';
}

function ap_grant(array $cfg, string $cookie, bool $https, string $profile = ''): void
{
  $exp = time() + (int)$cfg['days'] * 86400;
  ap_set_cookie($cookie, $exp . '.' . ap_sign($exp, $cfg['secret']), $exp, $https);
  $known = array_column(ap_state_read()['profiles'], 'id');
  $target = in_array($profile, $known, true) ? '/?profil=' . rawurlencode($profile) : '/';
  header('Location: ' . $target, true, 302);
  exit;
}

function ap_login_page(array $cfg, ?string $error, int $status): void
{
  http_response_code($status);
  header('Content-Type: text/html; charset=utf-8');
  header('Cache-Control: no-store');
  $message = $error !== null ? htmlspecialchars($error, ENT_QUOTES, 'UTF-8') : '';
  $open = $error !== null ? ' open' : '';
  $shake = $error !== null ? ' shake' : '';
  $length = max(4, min(6, (int)($cfg['pin_length'] ?? 4)));
  $boxes = '';
  for ($i = 1; $i <= $length; $i++) {
    $boxes .= '<input class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="off" aria-label="Chiffre ' . $i . '">';
  }
  $tiles = '';
  $selected = htmlspecialchars((string)($_POST['profil'] ?? ''), ENT_QUOTES, 'UTF-8');
  foreach (ap_state_read()['profiles'] as $index => $profile) {
    $id = htmlspecialchars((string)$profile['id'], ENT_QUOTES, 'UTF-8');
    $name = htmlspecialchars((string)$profile['name'], ENT_QUOTES, 'UTF-8');
    $focus = $index === 0 ? ' autofocus' : '';
    $tiles .= '<button class="profile" type="button" data-id="' . $id . '"' . $focus . '><span class="avatar">' . ap_avatar((string)$profile['avatar'])
      . '</span><span class="name">' . $name . '</span><svg class="padlock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-label="Profil verrouillé"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></button>';
  }
  $host = htmlspecialchars((string)($_SERVER['HTTP_HOST'] ?? ''), ENT_QUOTES, 'UTF-8');
  echo <<<HTML
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#141414">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AlexFlix">
<meta property="og:title" content="AlexFlix">
<meta property="og:description" content="Films et séries de la maison — vidéothèque privée">
<meta property="og:image" content="https://{$host}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>AlexFlix</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23141414'/%3E%3Cpath d='M18 54 L29 10 H35 L46 54 H38.5 L36.3 44 H27.7 L25.5 54 Z M29.2 37 H34.8 L32 23.5 Z' fill='%23e50914'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#141414;color:#e5e5e5;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
header{padding:24px 48px}
.logo{font-family:'Bebas Neue',Impact,sans-serif;font-size:36px;letter-spacing:.06em;line-height:1}
.logo .a{background:linear-gradient(#ff3b47,#e50914,#9d0610);-webkit-background-clip:text;background-clip:text;color:transparent}
.logo .p{margin-left:.16em;background:linear-gradient(#fff,#9a9a9a);-webkit-background-clip:text;background-clip:text;color:transparent}
main{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:calc(100vh - 160px);padding:0 24px 64px;animation:fade .5s ease}
h1{margin:0;font-size:clamp(34px,5vw,58px);font-weight:500;color:#fff}
.profiles{margin-top:40px;display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(16px,2.5vw,32px)}
.profile{display:flex;flex-direction:column;align-items:center;gap:14px;background:none;border:0;cursor:pointer;color:#808080;font:inherit}
.avatar{width:clamp(96px,10vw,150px);height:clamp(96px,10vw,150px);border-radius:6px;overflow:hidden;outline:3px solid transparent;transition:outline-color .2s}
.avatar img,.avatar svg{display:block;width:100%;height:100%;object-fit:cover}
.profile:hover .avatar,.profile:focus-visible .avatar{outline-color:#fff}
.profile:hover .name,.profile:focus-visible .name{color:#fff}
.name{font-size:clamp(16px,1.6vw,21px);transition:color .2s}
.padlock{width:20px;height:20px;opacity:.7}
.lock{position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px;background:#141414;animation:fade .25s ease}
.lock.open{display:flex}
.close{position:absolute;top:24px;right:32px;background:none;border:0;color:#fff;font-size:44px;line-height:1;cursor:pointer}
.hint{margin:0 0 10px;color:#b3b3b3;font-size:clamp(15px,1.4vw,19px)}
h2{margin:0 0 34px;max-width:640px;text-align:center;font-size:clamp(22px,3vw,36px);font-weight:500;color:#fff}
.pins{display:flex;gap:14px}
.pin{width:clamp(56px,7vw,86px);height:clamp(56px,7vw,86px);border:2px solid #fff;border-radius:6px;background:transparent;color:#fff;font-size:clamp(28px,3.5vw,44px);text-align:center;outline:none;caret-color:transparent;transition:transform .15s,border-color .15s}
.pin:focus{transform:scale(1.08);border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.25)}
.err{min-height:24px;margin:22px 0 0;color:#e87c03;font-size:16px}
.shake .pins{animation:shake .45s}
@keyframes shake{20%,60%{transform:translateX(-10px)}40%,80%{transform:translateX(10px)}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@media(max-width:520px){header{padding:20px}.pins{gap:10px}}
</style>
</head>
<body>
<header><span class="logo"><span class="a">ALEXFLIX</span></span></header>
<main>
<h1>Qui est-ce ?</h1>
<div class="profiles">{$tiles}</div>
</main>
<div class="lock{$open}{$shake}" id="lock" role="dialog" aria-modal="true" aria-label="Code PIN">
<button class="close" id="close" type="button" aria-label="Fermer">&times;</button>
<p class="hint">Le verrouillage de profil est activé.</p>
<h2>Entrez votre code PIN pour accéder à ce profil.</h2>
<form method="post" action="/__login" id="form" autocomplete="off">
<div class="pins">{$boxes}</div>
<input type="hidden" name="pin" id="code">
<input type="hidden" name="profil" id="profil" value="{$selected}">
</form>
<p class="err" id="err">{$message}</p>
</div>
<script>
(function () {
  var lock = document.getElementById('lock');
  var form = document.getElementById('form');
  var code = document.getElementById('code');
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.pin'));
  var sent = false;
  function reset() { boxes.forEach(function (b) { b.value = ''; }); sent = false; boxes[0].focus(); }
  function submitIfComplete() {
    var value = boxes.map(function (b) { return b.value; }).join('');
    if (value.length === boxes.length && !sent) { sent = true; code.value = value; form.submit(); }
  }
  var profiles = Array.prototype.slice.call(document.querySelectorAll('.profile'));
  profiles.forEach(function (tile) {
    tile.addEventListener('click', function () {
      document.getElementById('profil').value = tile.getAttribute('data-id') || '';
      lock.classList.remove('shake');
      document.getElementById('err').textContent = '';
      lock.classList.add('open');
      reset();
    });
  });
  document.getElementById('close').addEventListener('click', function () { lock.classList.remove('open'); if (profiles[0]) profiles[0].focus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && lock.classList.contains('open')) lock.classList.remove('open'); });
  boxes.forEach(function (box, i) {
    box.addEventListener('input', function () {
      box.value = box.value.replace(/\D/g, '').slice(-1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
      submitIfComplete();
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !box.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ''; boxes[i - 1].focus(); }
    });
    box.addEventListener('paste', function (e) {
      var text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '');
      if (!text) return;
      e.preventDefault();
      boxes.forEach(function (b, j) { b.value = text.charAt(j) || ''; });
      submitIfComplete();
    });
  });
  if (lock.classList.contains('open')) reset();
})();
</script>
</body>
</html>
HTML;
  exit;
}

$path = rawurldecode((string)(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/'));

if ($path === '/__logout') {
  ap_set_cookie($cookie, '', time() - 3600, $https);
  header('Location: /', true, 302);
  exit;
}

if (strpos($path, '/__acces/') === 0) {
  $token = substr($path, strlen('/__acces/'));
  if (isset($cfg['access']) && hash_equals((string)$cfg['access'], $token)) ap_grant($cfg, $cookie, $https);
  usleep(500000);
  ap_login_page($cfg, 'Lien d’accès invalide.', 403);
}

if ($path === '/__login') {
  if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Location: /', true, 302);
    exit;
  }
  $attemptsFile = __DIR__ . '/.ap-attempts.json';
  $ip = 'ip:' . (string)($_SERVER['REMOTE_ADDR'] ?? 'inconnu');
  $now = time();
  $attempts = is_file($attemptsFile) ? (json_decode((string)@file_get_contents($attemptsFile), true) ?: []) : [];
  foreach ($attempts as $key => $entry) {
    if (!is_array($entry) || ($entry['reset'] ?? 0) < $now) unset($attempts[$key]);
  }
  $entry = $attempts[$ip] ?? ['count' => 0, 'reset' => $now + 900];
  $global = $attempts['global'] ?? ['count' => 0, 'reset' => $now + 3600];
  if ($entry['count'] >= 5) ap_login_page($cfg, 'Trop d’essais. Réessayez dans 15 minutes.', 429);
  if ($global['count'] >= 40) ap_login_page($cfg, 'Profil temporairement verrouillé. Réessayez dans 1 heure.', 429);

  $pin = preg_replace('/\D/', '', (string)($_POST['pin'] ?? ''));
  $hash = hash_pbkdf2('sha256', (string)$pin, $cfg['salt'], (int)$cfg['iterations'], 64);
  if ($pin !== '' && hash_equals($cfg['hash'], $hash)) {
    unset($attempts[$ip]);
    @file_put_contents($attemptsFile, json_encode($attempts), LOCK_EX);
    ap_grant($cfg, $cookie, $https, (string)($_POST['profil'] ?? ''));
  }
  $entry['count']++;
  $global['count']++;
  $attempts[$ip] = $entry;
  $attempts['global'] = $global;
  @file_put_contents($attemptsFile, json_encode($attempts), LOCK_EX);
  usleep(400000);
  ap_login_page($cfg, 'Code PIN incorrect. Veuillez réessayer.', 401);
}

$public = ['/avatar.jpg', '/favicon.svg', '/robots.txt', '/og.png', '/apple-touch-icon.png', '/icon-512.png', '/manifest.webmanifest'];
$isPublic = in_array($path, $public, true) || preg_match('#^/avatars/[a-f0-9]{16}\.jpg$#', $path) === 1;
if (!$isPublic && preg_match('#^/images/([a-z0-9-]+\.jpg)$#', $path, $match) === 1) {
  $isPublic = in_array('film:' . $match[1], array_column(ap_state_read()['profiles'], 'avatar'), true);
}
if (!$isPublic && !ap_is_authed($cfg, $cookie) && !ap_is_home($cfg)) {
  $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
  if ($ext === '' || $ext === 'html') ap_login_page($cfg, null, 200);
  http_response_code(401);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo '{"error":"Session expirée ou absente."}';
  exit;
}

if (strpos($path, '/__api/') === 0) {
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  if ($path === '/__api/state' && $method === 'GET') {
    echo json_encode(ap_state_read(), JSON_UNESCAPED_UNICODE);
    exit;
  }
  // Synchronisation demandée depuis Paramètres : le PC (npm run sync-agent) la récupère et lance le deploy.
  if ($path === '/__api/sync') {
    $syncFile = __DIR__ . '/.ap-sync.json';
    if ($method === 'GET') {
      echo is_file($syncFile) ? (string)file_get_contents($syncFile) : '{"requestedAt":null}';
      exit;
    }
    $body = json_decode((string)file_get_contents('php://input'), true);
    $action = is_array($body) ? (string)($body['action'] ?? '') : '';
    if ($method === 'POST' && ($action === 'request' || $action === 'check')) {
      $current = is_file($syncFile) ? json_decode((string)file_get_contents($syncFile), true) : null;
      // Une synchro demandée l'emporte sur une simple vérification.
      if (!is_array($current) || empty($current['requestedAt']) || ($action === 'request' && ($current['kind'] ?? 'sync') === 'check')) {
        @file_put_contents($syncFile, json_encode(['requestedAt' => gmdate('c'), 'kind' => $action === 'check' ? 'check' : 'sync']), LOCK_EX);
      }
      echo '{"ok":true}';
      exit;
    }
    if ($method === 'POST' && $action === 'clear') {
      @unlink($syncFile);
      echo '{"ok":true}';
      exit;
    }
    http_response_code(400);
    echo '{"error":"Action inconnue"}';
    exit;
  }
  if ($path === '/__api/avatars' && $method === 'GET') {
    $files = (array)glob(__DIR__ . '/avatars/*.jpg');
    usort($files, function ($a, $b) { return (int)@filemtime((string)$b) <=> (int)@filemtime((string)$a); });
    $avatars = [];
    foreach ($files as $file) {
      if (is_string($file) && preg_match('/^([a-f0-9]{16})\.jpg$/', basename($file), $match) === 1) $avatars[] = 'custom:' . $match[1];
    }
    echo json_encode(['avatars' => $avatars]);
    exit;
  }
  if ($method !== 'POST' || stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== 0) {
    http_response_code(400);
    echo '{"error":"Requête invalide"}';
    exit;
  }
  $body = json_decode((string)file_get_contents('php://input'), true);
  if (!is_array($body)) {
    http_response_code(400);
    echo '{"error":"Corps JSON invalide"}';
    exit;
  }

  if ($path === '/__api/profiles') {
    $profiles = ap_clean_profiles($body['profiles'] ?? null);
    if ($profiles === null) {
      http_response_code(400);
      echo '{"error":"Profils invalides (1 à 5, nom de 1 à 20 caractères)"}';
      exit;
    }
    ap_state_update(function (array $state) use ($profiles): array {
      $state['profiles'] = $profiles;
      $ids = array_column($profiles, 'id');
      foreach (array_keys($state['data']) as $id) {
        if (!in_array($id, $ids, true)) unset($state['data'][$id]);
      }
      return $state;
    });
    echo '{"ok":true}';
    exit;
  }

  if ($path === '/__api/avatar-delete') {
    $avatar = (string)($body['avatar'] ?? '');
    if (preg_match('/^custom:([a-f0-9]{16})$/', $avatar, $match) !== 1) {
      http_response_code(400);
      echo '{"error":"Image inconnue"}';
      exit;
    }
    @unlink(__DIR__ . '/avatars/' . $match[1] . '.jpg');
    ap_state_update(function (array $state) use ($avatar): array {
      foreach ($state['profiles'] as $index => $profile) {
        if (($profile['avatar'] ?? '') === $avatar) $state['profiles'][$index]['avatar'] = 'red';
      }
      return $state;
    });
    echo '{"ok":true}';
    exit;
  }

  if ($path === '/__api/avatar') {
    $data = (string)($body['image'] ?? '');
    if (!preg_match('#^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$#', $data, $match) || strlen($match[1]) > 700000) {
      http_response_code(400);
      echo '{"error":"Image invalide ou trop lourde"}';
      exit;
    }
    $binary = base64_decode($match[1], true);
    $info = $binary !== false ? @getimagesizefromstring($binary) : false;
    if ($binary === false || $info === false || ($info['mime'] ?? '') !== 'image/jpeg' || $info[0] > 1024 || $info[1] > 1024) {
      http_response_code(400);
      echo '{"error":"Image JPEG invalide"}';
      exit;
    }
    if (function_exists('imagecreatefromstring') && function_exists('imagejpeg')) {
      $image = @imagecreatefromstring($binary);
      if ($image !== false) {
        ob_start();
        imagejpeg($image, null, 88);
        $binary = (string)ob_get_clean();
        imagedestroy($image);
      }
    }
    $hash = substr(hash('sha256', $binary), 0, 16);
    if (!is_dir(__DIR__ . '/avatars')) @mkdir(__DIR__ . '/avatars', 0755, true);
    if (@file_put_contents(__DIR__ . '/avatars/' . $hash . '.jpg', $binary, LOCK_EX) === false) {
      http_response_code(500);
      echo '{"error":"Enregistrement de l’image impossible"}';
      exit;
    }
    echo json_encode(['avatar' => 'custom:' . $hash]);
    exit;
  }

  $profileId = (string)($body['profile'] ?? '');
  if (!in_array($profileId, array_column(ap_state_read()['profiles'], 'id'), true)) {
    http_response_code(404);
    echo '{"error":"Profil inconnu"}';
    exit;
  }

  if ($path === '/__api/favorites') {
    $favorites = [];
    foreach ((array)($body['favorites'] ?? []) as $id) {
      if (is_string($id) && preg_match('/^[a-z0-9-]{1,64}$/', $id) && !in_array($id, $favorites, true)) $favorites[] = $id;
      if (count($favorites) >= 500) break;
    }
    ap_state_update(function (array $state) use ($profileId, $favorites): array {
      $state['data'][$profileId] = array_merge($state['data'][$profileId] ?? [], ['favorites' => $favorites]);
      return $state;
    });
    echo '{"ok":true}';
    exit;
  }

  if ($path === '/__api/progress') {
    $entries = [];
    foreach (array_slice((array)($body['entries'] ?? []), 0, 100) as $entry) {
      if (!is_array($entry)) continue;
      $fileId = (string)($entry['fileId'] ?? '');
      $itemId = (string)($entry['itemId'] ?? '');
      if (!preg_match('/^[a-f0-9]{16}$/', $fileId) || !preg_match('/^[a-z0-9-]{1,64}$/', $itemId)) continue;
      $entries[$fileId] = [
        'itemId' => $itemId,
        'fileId' => $fileId,
        'position' => max(0, (float)($entry['position'] ?? 0)),
        'duration' => max(0, (float)($entry['duration'] ?? 0)),
        'updatedAt' => (int)($entry['updatedAt'] ?? 0),
      ];
    }
    ap_state_update(function (array $state) use ($profileId, $entries): array {
      $data = $state['data'][$profileId] ?? [];
      $progress = is_array($data['progress'] ?? null) ? $data['progress'] : [];
      foreach ($entries as $fileId => $entry) {
        if (!isset($progress[$fileId]) || (int)$progress[$fileId]['updatedAt'] <= $entry['updatedAt']) $progress[$fileId] = $entry;
      }
      uasort($progress, function ($a, $b) { return (int)$b['updatedAt'] <=> (int)$a['updatedAt']; });
      $data['progress'] = array_slice($progress, 0, 300, true);
      $state['data'][$profileId] = $data;
      return $state;
    });
    echo '{"ok":true}';
    exit;
  }

  http_response_code(404);
  echo '{"error":"Route inconnue"}';
  exit;
}

$rel = '/' . ltrim($path, '/');
if ($rel === '/') $rel = '/index.html';
foreach (explode('/', $rel) as $segment) {
  if ($segment !== '' && $segment[0] === '.') {
    http_response_code(404);
    exit;
  }
}
if (preg_match('/\.php$/i', $rel)) {
  http_response_code(404);
  exit;
}

$target = realpath($root . $rel);
if ($target === false || strpos($target, $root . DIRECTORY_SEPARATOR) !== 0 || !is_file($target)) {
  if (pathinfo($rel, PATHINFO_EXTENSION) !== '') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Introuvable';
    exit;
  }
  $target = $root . '/index.html';
}

$types = [
  'html' => 'text/html; charset=utf-8',
  'js' => 'text/javascript; charset=utf-8',
  'css' => 'text/css; charset=utf-8',
  'json' => 'application/json; charset=utf-8',
  'webmanifest' => 'application/manifest+json',
  'svg' => 'image/svg+xml',
  'jpg' => 'image/jpeg',
  'jpeg' => 'image/jpeg',
  'png' => 'image/png',
  'txt' => 'text/plain; charset=utf-8',
  'webp' => 'image/webp',
  'ico' => 'image/x-icon',
  'woff2' => 'font/woff2',
];
$ext = strtolower(pathinfo($target, PATHINFO_EXTENSION));
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
header('Content-Length: ' . (string)filesize($target));
if ($ext === 'html' || $ext === 'webmanifest' || basename($target) === 'catalog.json' || basename($target) === 'audio-status.json' || basename($target) === 'sync-status.json') {
  header('Cache-Control: private, no-cache');
} elseif (strpos($rel, '/assets/') === 0) {
  header('Cache-Control: private, max-age=31536000, immutable');
} else {
  header('Cache-Control: private, max-age=2592000');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') exit;
readfile($target);
`;
