<?php
declare(strict_types=1);

const MAX_BODY_BYTES = 12000;
const CATEGORIES = ['Ideas', 'Questions', 'Life', 'Creativity', 'Just because'];

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: DENY');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');

function json_response(int $status, mixed $payload): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function database(): PDO
{
    static $connection = null;
    if ($connection instanceof PDO) return $connection;

    $configFile = __DIR__ . DIRECTORY_SEPARATOR . 'config.local.php';
    if (!is_file($configFile)) throw new RuntimeException('Database config.local.php is missing.');
    $config = require $configFile;
    foreach (['host', 'port', 'database', 'username', 'password'] as $key) {
        if (!is_array($config) || !array_key_exists($key, $config) || !is_scalar($config[$key])) {
            throw new RuntimeException('Database configuration is incomplete.');
        }
    }
    $host = (string)$config['host'];
    $port = filter_var($config['port'], FILTER_VALIDATE_INT);
    $name = (string)$config['database'];
    if (!preg_match('/^[A-Za-z0-9._:-]+$/', $host)
        || !preg_match('/^[A-Za-z0-9_$-]+$/', $name)
        || !is_string($config['username']) || !is_string($config['password'])
        || $config['username'] === '' || $port === false || $port < 1 || $port > 65535) {
        throw new RuntimeException('Database configuration is invalid.');
    }
    if ($config['password'] === 'REPLACE_WITH_ROTATED_PASSWORD') {
        throw new RuntimeException('Replace the database password in config.local.php.');
    }

    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $name);
    $connection = new PDO($dsn, (string)$config['username'], (string)$config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    ensure_database_schema($connection);
    return $connection;
}

function ensure_database_schema(PDO $db): void
{
    static $initialized = false;
    if ($initialized) return;
    $schemaPath = __DIR__ . DIRECTORY_SEPARATOR . 'schema.sql';
    $schema = file_get_contents($schemaPath);
    if ($schema === false) throw new RuntimeException('Unable to read schema.sql.');
    $schema = preg_replace('/^\s*--.*$/m', '', $schema);
    if (!is_string($schema)) throw new RuntimeException('Unable to parse schema.sql.');
    foreach (array_filter(array_map('trim', explode(';', $schema))) as $statement) {
        $db->exec($statement);
    }
    $initialized = true;
}

function public_note(array $note): array
{
    $note['anonymous'] = (bool)$note['anonymous'];
    $note['createdAt'] = (int)$note['createdAt'];
    $note['likes'] = (int)$note['likes'];
    $note['replyCount'] = (int)$note['replyCount'];
    return $note;
}

function request_data(): array
{
    require_same_origin_json_write();
    $length = filter_var($_SERVER['CONTENT_LENGTH'] ?? null, FILTER_VALIDATE_INT);
    if ($length !== false && $length !== null && $length > MAX_BODY_BYTES) json_response(413, ['error' => 'Request too large.']);
    $stream = fopen('php://input', 'rb');
    $body = $stream === false ? false : stream_get_contents($stream, MAX_BODY_BYTES + 1);
    if (is_resource($stream)) fclose($stream);
    if ($body === false || strlen($body) > MAX_BODY_BYTES) json_response(413, ['error' => 'Request too large.']);
    try {
        $data = json_decode($body === '' ? '{}' : $body, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        json_response(400, ['error' => 'Invalid JSON.']);
    }
    if (!is_array($data)) json_response(400, ['error' => 'Invalid request.']);
    return $data;
}

function require_same_origin_json_write(): void
{
    $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($contentType !== 'application/json') json_response(415, ['error' => 'Send this request as JSON.']);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') return;

    $originHost = parse_url($origin, PHP_URL_HOST);
    $originScheme = strtolower((string)parse_url($origin, PHP_URL_SCHEME));
    $requestHost = parse_url('//' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST);
    $originPort = parse_url($origin, PHP_URL_PORT) ?: ($originScheme === 'https' ? 443 : 80);
    $https = !empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off';
    $requestPort = parse_url('//' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_PORT) ?: ($https ? 443 : 80);
    $requestScheme = $https ? 'https' : 'http';
    if (!is_string($originHost) || !is_string($requestHost)
        || !in_array($originScheme, ['http', 'https'], true)
        || strcasecmp($originHost, $requestHost) !== 0
        || $originScheme !== $requestScheme || $originPort !== $requestPort) {
        json_response(403, ['error' => 'Cross-origin writes are not allowed.']);
    }
}

function text_length(string $value): int
{
    $matched = preg_match_all('/./us', $value, $characters);
    return $matched === false ? strlen($value) : $matched;
}

function text_slice(string $value, int $length): string
{
    if (function_exists('mb_substr')) return mb_substr($value, 0, $length, 'UTF-8');
    $characters = preg_split('//u', $value, -1, PREG_SPLIT_NO_EMPTY);
    return $characters === false ? substr($value, 0, $length) : implode('', array_slice($characters, 0, $length));
}

function make_uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
}

function bump_revision(PDO $db): void
{
    $db->exec('UPDATE thoughtspace_wall_state SET revision = revision + 1 WHERE id = 1');
}

function stream_events(): never
{
    $db = database();
    $revision = (int)$db->query('SELECT revision FROM thoughtspace_wall_state WHERE id = 1')->fetchColumn();
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache, no-transform');
    header('X-Accel-Buffering: no');
    while (ob_get_level() > 0) ob_end_flush();
    ob_implicit_flush(true);

    $previous = $_SERVER['HTTP_LAST_EVENT_ID'] ?? '';
    echo "retry: 5000\n";
    if ($previous === '') echo "id: {$revision}\nevent: ready\ndata: {}\n\n";
    elseif (!ctype_digit($previous) || (int)$previous !== $revision) echo "id: {$revision}\nevent: sync\ndata: {}\n\n";
    else echo ": unchanged\n\n";
    flush();
    exit;
}

$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $db = database();
    if ($path === '/api/events' && $method === 'GET') stream_events();

    if ($path === '/api/notes' && $method === 'GET') {
        $query = 'SELECT n.id, n.title, n.content, n.category, n.anonymous, n.author, n.created_at AS createdAt,
                         (SELECT COUNT(*) FROM thoughtspace_likes l WHERE l.note_id = n.id) AS likes,
                         (SELECT COUNT(*) FROM thoughtspace_replies r WHERE r.note_id = n.id) AS replyCount
                  FROM thoughtspace_notes n ORDER BY n.created_at DESC, n.id DESC';
        $notes = array_map('public_note', $db->query($query)->fetchAll());
        json_response(200, $notes);
    }

    if ($path === '/api/notes' && $method === 'POST') {
        $data = request_data();
        $content = is_string($data['content'] ?? null) ? trim($data['content']) : '';
        $title = is_string($data['title'] ?? null) ? text_slice(trim($data['title']), 90) : '';
        $author = is_string($data['author'] ?? null) ? text_slice(trim($data['author']), 40) : '';
        if ($author === '') $author = 'Someone';
        $category = in_array($data['category'] ?? '', CATEGORIES, true) ? $data['category'] : '';
        if ($content === '' || text_length($content) > 500) json_response(400, ['error' => 'A note must contain 1 to 500 characters.']);
        $anonymous = ($data['anonymous'] ?? false) === true;
        $note = ['id' => make_uuid(), 'title' => $title, 'content' => $content, 'category' => $category,
            'anonymous' => $anonymous, 'author' => $anonymous ? '' : $author, 'createdAt' => (int)floor(microtime(true) * 1000), 'likes' => 0, 'replyCount' => 0];
        $db->beginTransaction();
        $insert = $db->prepare('INSERT INTO thoughtspace_notes (id, title, content, category, anonymous, author, created_at) VALUES (:id, :title, :content, :category, :anonymous, :author, :created_at)');
        $insert->execute(['id' => $note['id'], 'title' => $note['title'], 'content' => $content, 'category' => $category,
            'anonymous' => (int)$anonymous, 'author' => $note['author'], 'created_at' => $note['createdAt']]);
        bump_revision($db);
        $db->commit();
        json_response(201, $note);
    }

    if (preg_match('~^/api/notes/([\\w-]+)/replies$~', $path, $match)) {
        $noteId = $match[1];
        if ($method === 'GET') {
            $query = $db->prepare('SELECT id, note_id AS noteId, content, author, anonymous, created_at AS createdAt FROM thoughtspace_replies WHERE note_id = :note_id ORDER BY created_at ASC, id ASC');
            $query->execute(['note_id' => $noteId]);
            $replies = $query->fetchAll();
            foreach ($replies as &$reply) { $reply['anonymous'] = (bool)$reply['anonymous']; $reply['createdAt'] = (int)$reply['createdAt']; }
            unset($reply);
            $exists = $db->prepare('SELECT 1 FROM thoughtspace_notes WHERE id = :id');
            $exists->execute(['id' => $noteId]);
            if (!$exists->fetchColumn()) json_response(404, ['error' => 'Note not found.']);
            json_response(200, $replies);
        }
        if ($method === 'POST') {
            $data = request_data();
            $id = is_string($data['id'] ?? null) ? text_slice(trim($data['id']), 80) : '';
            $content = is_string($data['content'] ?? null) ? trim($data['content']) : '';
            $author = is_string($data['author'] ?? null) ? text_slice(trim($data['author']), 40) : '';
            if ($author === '') $author = 'Someone';
            $anonymous = ($data['anonymous'] ?? false) === true;
            if ($id === '' || $content === '' || text_length($content) > 500) json_response(400, ['error' => 'A reply needs an ID and 1 to 500 characters.']);

            $db->beginTransaction();
            $exists = $db->prepare('SELECT 1 FROM thoughtspace_notes WHERE id = :id');
            $exists->execute(['id' => $noteId]);
            if (!$exists->fetchColumn()) { $db->rollBack(); json_response(404, ['error' => 'Note not found.']); }
            $find = $db->prepare('SELECT id, note_id AS noteId, content, author, anonymous, created_at AS createdAt FROM thoughtspace_replies WHERE note_id = :note_id AND id = :id');
            $find->execute(['note_id' => $noteId, 'id' => $id]);
            $reply = $find->fetch();
            if ($reply) {
                $count = $db->prepare('SELECT COUNT(*) FROM thoughtspace_replies WHERE note_id = :note_id');
                $count->execute(['note_id' => $noteId]);
                $reply['anonymous'] = (bool)$reply['anonymous']; $reply['createdAt'] = (int)$reply['createdAt'];
                $db->commit();
                json_response(200, ['reply' => $reply, 'replyCount' => (int)$count->fetchColumn()]);
            }
            $reply = ['id' => $id, 'noteId' => $noteId, 'content' => $content, 'author' => $anonymous ? '' : $author,
                'anonymous' => $anonymous, 'createdAt' => (int)floor(microtime(true) * 1000)];
            $insert = $db->prepare('INSERT INTO thoughtspace_replies (id, note_id, content, author, anonymous, created_at) VALUES (:id, :note_id, :content, :author, :anonymous, :created_at)');
            $insert->execute(['id' => $id, 'note_id' => $noteId, 'content' => $content, 'author' => $reply['author'], 'anonymous' => (int)$anonymous, 'created_at' => $reply['createdAt']]);
            bump_revision($db);
            $count = $db->prepare('SELECT COUNT(*) FROM thoughtspace_replies WHERE note_id = :note_id');
            $count->execute(['note_id' => $noteId]);
            $replyCount = (int)$count->fetchColumn();
            $db->commit();
            json_response(201, ['reply' => $reply, 'replyCount' => $replyCount]);
        }
    }

    if (preg_match('~^/api/notes/([\\w-]+)/like$~', $path, $match) && $method === 'POST') {
        $data = request_data();
        if (!is_string($data['clientId'] ?? null) || $data['clientId'] === '' || strlen($data['clientId']) > 80 || !is_bool($data['liked'] ?? null)) json_response(400, ['error' => 'Invalid reaction.']);
        $noteId = $match[1];
        $exists = $db->prepare('SELECT 1 FROM thoughtspace_notes WHERE id = :id');
        $exists->execute(['id' => $noteId]);
        if (!$exists->fetchColumn()) json_response(404, ['error' => 'Note not found.']);
        $db->beginTransaction();
        if ($data['liked']) {
            $change = $db->prepare('INSERT IGNORE INTO thoughtspace_likes (note_id, client_id) VALUES (:note_id, :client_id)');
            $change->execute(['note_id' => $noteId, 'client_id' => $data['clientId']]);
        } else {
            $change = $db->prepare('DELETE FROM thoughtspace_likes WHERE note_id = :note_id AND client_id = :client_id');
            $change->execute(['note_id' => $noteId, 'client_id' => $data['clientId']]);
        }
        if ($change->rowCount() > 0) bump_revision($db);
        $count = $db->prepare('SELECT COUNT(*) FROM thoughtspace_likes WHERE note_id = :note_id');
        $count->execute(['note_id' => $noteId]);
        $likes = (int)$count->fetchColumn();
        $db->commit();
        json_response(200, ['likes' => $likes]);
    }

    if (in_array($path, ['/api/notes', '/api/events'], true) || preg_match('~^/api/notes/[\\w-]+/(?:replies|like)$~', $path)) {
        header('Allow: ' . ($path === '/api/notes' ? 'GET, POST' : ($path === '/api/events' ? 'GET' : 'GET, POST')));
        json_response(405, ['error' => 'Method not allowed.']);
    }
    if (str_starts_with($path, '/api/')) json_response(404, ['error' => 'Not found.']);
    json_response(404, ['error' => 'Not found.']);
} catch (PDOException $error) {
    if (isset($db) && $db instanceof PDO && $db->inTransaction()) $db->rollBack();
    error_log('ThoughtSpace API error: ' . $error->getMessage());
    json_response(503, ['error' => 'Database connection or table setup failed. Check the MySQL credentials and that this database user can create tables.']);
} catch (RuntimeException $error) {
    if (isset($db) && $db instanceof PDO && $db->inTransaction()) $db->rollBack();
    error_log('ThoughtSpace API setup error: ' . $error->getMessage());
    json_response(503, ['error' => 'Database is not configured yet. Set the credentials in config.local.php and verify schema setup.']);
} catch (Throwable $error) {
    if (isset($db) && $db instanceof PDO && $db->inTransaction()) $db->rollBack();
    error_log('ThoughtSpace API error: ' . $error->getMessage());
    json_response(500, ['error' => 'The request could not be completed.']);
}
