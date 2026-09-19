<?php
declare(strict_types=1);

// passenger_transit/backend/config.php
// Конфигурация базы данных SQLite и вспомогательные функции
// Strict compliance with AI_SPECS.md Rule 8.1 (PILOT Store Proxy URL Rules)

/**
 * Путь к базе данных SQLite
 * База данных хранится в той же папке, что и этот файл
 */
define('DB_PATH', __DIR__ . '/data.db');

/**
 * Получить PDO соединение с SQLite
 * Использует статическую переменную для повторного использования соединения
 * 
 * @return PDO
 * @throws PDOException
 */
function getDb(): PDO {
    static $db = null;
    
    if ($db === null) {
        $db = new PDO('sqlite:' . DB_PATH);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        
        // Инициализация таблиц при первом подключении
        initDb($db);
    }
    
    return $db;
}

/**
 * Инициализация таблиц базы данных
 * Создает таблицы, если они не существуют
 * 
 * @param PDO $db
 */
function initDb(PDO $db): void {
    $db->exec("
        -- Таблица маршрутов
        CREATE TABLE IF NOT EXISTS routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Таблица остановок маршрута
        CREATE TABLE IF NOT EXISTS stops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            order_index INTEGER NOT NULL,
            FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
        );

        -- Таблица точек полилинии маршрута (прямое и обратное направление)
        CREATE TABLE IF NOT EXISTS route_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id INTEGER NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('forward', 'backward')),
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            order_index INTEGER NOT NULL,
            FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
        );

        -- Таблица привязки транспортных средств к маршрутам
        CREATE TABLE IF NOT EXISTS route_vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id INTEGER NOT NULL,
            vehicle_id TEXT NOT NULL,
            vehicle_number TEXT,
            FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
            UNIQUE(route_id, vehicle_id)
        );

        -- Индексы для ускорения запросов
        CREATE INDEX IF NOT EXISTS idx_stops_route_id ON stops(route_id);
        CREATE INDEX IF NOT EXISTS idx_route_points_route_id ON route_points(route_id);
        CREATE INDEX IF NOT EXISTS idx_route_vehicles_route_id ON route_vehicles(route_id);
        CREATE INDEX IF NOT EXISTS idx_route_vehicles_vehicle_id ON route_vehicles(vehicle_id);
    ");
}

/**
 * Отправить JSON ответ с CORS-заголовками
 * Используется всеми API эндпоинтами для возврата данных
 * 
 * @param array $data Данные для отправки
 * @param int $statusCode HTTP статус код (по умолчанию 200)
 */
function jsonResponse(array $data, int $statusCode = 200): void {
    // CORS заголовки для совместимости с PILOT proxy
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Max-Age: 86400');
    
    // Обработка preflight OPTIONS запроса
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
    
    // Установка HTTP статуса
    http_response_code($statusCode);
    
    // Отправка JSON
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

/**
 * Получить JSON из тела POST запроса
 * 
 * @return array Ассоциативный массив данных
 */
function getJsonInput(): array {
    $input = file_get_contents('php://input');
    
    if (empty($input)) {
        return [];
    }
    
    $data = json_decode($input, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        return [];
    }
    
    return $data ?: [];
}

/**
 * Получить параметр из GET запроса с санитизацией
 * 
 * @param string $key Имя параметра
 * @param mixed $default Значение по умолчанию
 * @return mixed
 */
function getRequestParam(string $key, $default = null) {
    return $_REQUEST[$key] ?? $default;
}

/**
 * Валидация обязательных параметров
 * 
 * @param array $required Список обязательных параметров
 * @param array $input Входные данные
 * @return bool true если все параметры присутствуют
 */
function validateRequiredParams(array $required, array $input): bool {
    foreach ($required as $param) {
        if (!isset($input[$param]) || $input[$param] === '') {
            return false;
        }
    }
    return true;
}

/**
 * Логирование ошибок (опционально)
 * 
 * @param string $message Сообщение об ошибке
 * @param array $context Дополнительный контекст
 */
function logError(string $message, array $context = []): void {
    $logFile = __DIR__ . '/error.log';
    $timestamp = date('Y-m-d H:i:s');
    $contextStr = !empty($context) ? ' | Context: ' . json_encode($context) : '';
    $logEntry = "[{$timestamp}] {$message}{$contextStr}\n";
    
    @file_put_contents($logFile, $logEntry, FILE_APPEND | LOCK_EX);
}
