<?php
declare(strict_types=1);

// passenger_transit/backend/api.php
// Главный роутер API для расширения passenger_transit
// Strict compliance with AI_SPECS.md Rule 8.1 (PILOT Store Proxy URL Rules)

require_once __DIR__ . '/config.php';

// Получение параметра action из запроса
$action = getRequestParam('action', '');

// Маршрутизация запросов
try {
    switch ($action) {
        // ==================== МАРШРУТЫ ====================
        
        case 'get_routes':
            getRoutes();
            break;
            
        case 'create_route':
            createRoute();
            break;
            
        case 'delete_route':
            deleteRoute();
            break;
            
        case 'rename_route':
            renameRoute();
            break;
            
        // ==================== ОСТАНОВКИ ====================
        
        case 'add_stop':
            addStop();
            break;
            
        case 'delete_stop':
            deleteStop();
            break;
            
        case 'reorder_stop':
            reorderStop();
            break;
            
        // ==================== ТОЧКИ МАРШРУТА (ПОЛИЛИНИЯ) ====================
        
        case 'save_route_points':
            saveRoutePoints();
            break;
            
        case 'get_route_points':
            getRoutePoints();
            break;
            
        case 'delete_route_points':
            deleteRoutePoints();
            break;
            
        // ==================== ПРИВЯЗКА ТС ====================
        
        case 'get_route_vehicles':
            getRouteVehicles();
            break;
            
        case 'bind_vehicle':
            bindVehicle();
            break;
            
        case 'unbind_vehicle':
            unbindVehicle();
            break;
            
        // ==================== ТРЕКИ И РЕЙСЫ ====================
        
        case 'get_vehicle_track':
            getVehicleTrack();
            break;
            
        case 'get_timeline':
            getTimeline();
            break;
            
        case 'count_trips':
            countTrips();
            break;
            
        // ==================== НЕИЗВЕСТНОЕ ДЕЙСТВИЕ ====================
        
        default:
            jsonResponse([
                'success' => false,
                'error' => 'Unknown action: ' . $action,
                'available_actions' => [
                    'get_routes', 'create_route', 'delete_route', 'rename_route',
                    'add_stop', 'delete_stop', 'reorder_stop',
                    'save_route_points', 'get_route_points', 'delete_route_points',
                    'get_route_vehicles', 'bind_vehicle', 'unbind_vehicle',
                    'get_vehicle_track', 'get_timeline', 'count_trips'
                ]
            ], 400);
    }
} catch (PDOException $e) {
    logError('Database error: ' . $e->getMessage(), ['action' => $action]);
    jsonResponse([
        'success' => false,
        'error' => 'Database error: ' . $e->getMessage()
    ], 500);
} catch (Exception $e) {
    logError('General error: ' . $e->getMessage(), ['action' => $action]);
    jsonResponse([
        'success' => false,
        'error' => 'Server error: ' . $e->getMessage()
    ], 500);
}


// ==================== ФУНКЦИИ ОБРАБОТКИ МАРШРУТОВ ====================

/**
 * Получить список всех маршрутов с остановками и точками
 */
function getRoutes(): void {
    $db = getDb();
    
    $routes = $db->query("
        SELECT 
            r.id, 
            r.name, 
            r.created_at,
            (SELECT COUNT(*) FROM route_vehicles WHERE route_id = r.id) as vehicle_count,
            (SELECT COUNT(*) FROM stops WHERE route_id = r.id) as stop_count
        FROM routes r
        ORDER BY r.name ASC
    ")->fetchAll();
    
    // Для каждого маршрута загружаем связанные данные
    foreach ($routes as &$route) {
        $routeId = (int)$route['id'];
        
        // Остановки
        $route['stops'] = $db->query("
            SELECT id, name, lat, lon, order_index
            FROM stops 
            WHERE route_id = $routeId
            ORDER BY order_index ASC
        ")->fetchAll();
        
        // Точки прямого направления
        $route['forward_points'] = $db->query("
            SELECT id, lat, lon, order_index
            FROM route_points 
            WHERE route_id = $routeId AND direction = 'forward'
            ORDER BY order_index ASC
        ")->fetchAll();
        
        // Точки обратного направления
        $route['backward_points'] = $db->query("
            SELECT id, lat, lon, order_index
            FROM route_points 
            WHERE route_id = $routeId AND direction = 'backward'
            ORDER BY order_index ASC
        ")->fetchAll();
    }
    
    jsonResponse([
        'success' => true,
        'routes' => $routes,
        'count' => count($routes)
    ]);
}

/**
 * Создать новый маршрут
 */
function createRoute(): void {
    $input = getJsonInput();
    
    if (!validateRequiredParams(['name'], $input)) {
        jsonResponse(['success' => false, 'error' => 'Parameter "name" is required'], 400);
    }
    
    $name = trim($input['name']);
    
    if (mb_strlen($name) < 2) {
        jsonResponse(['success' => false, 'error' => 'Route name must be at least 2 characters'], 400);
    }
    
    $db = getDb();
    $stmt = $db->prepare("INSERT INTO routes (name) VALUES (?)");
    $stmt->execute([$name]);
    
    jsonResponse([
        'success' => true,
        'id' => (int)$db->lastInsertId(),
        'name' => $name
    ], 201);
}

/**
 * Удалить маршрут
 */
function deleteRoute(): void {
    $input = getJsonInput();
    
    if (!isset($input['id']) || !is_numeric($input['id'])) {
        jsonResponse(['success' => false, 'error' => 'Parameter "id" is required'], 400);
    }
    
    $routeId = (int)$input['id'];
    $db = getDb();
    
    // Проверяем существование маршрута
    $stmt = $db->prepare("SELECT id FROM routes WHERE id = ?");
    $stmt->execute([$routeId]);
    
    if (!$stmt->fetch()) {
        jsonResponse(['success' => false, 'error' => 'Route not found'], 404);
    }
    
    // Удаляем маршрут (CASCADE удалит связанные записи)
    $stmt = $db->prepare("DELETE FROM routes WHERE id = ?");
    $stmt->execute([$routeId]);
    
    jsonResponse(['success' => true, 'deleted_id' => $routeId]);
}

/**
 * Переименовать маршрут
 */
function renameRoute(): void {
    $input = getJsonInput();
    
    if (!validateRequiredParams(['id', 'name'], $input)) {
        jsonResponse(['success' => false, 'error' => 'Parameters "id" and "name" are required'], 400);
    }
    
    $routeId = (int)$input['id'];
    $newName = trim($input['name']);
    
    if (mb_strlen($newName) < 2) {
        jsonResponse(['success' => false, 'error' => 'Route name must be at least 2 characters'], 400);
    }
    
    $db = getDb();
    $stmt = $db->prepare("UPDATE routes SET name = ? WHERE id = ?");
    $stmt->execute([$newName, $routeId]);
    
    if ($stmt->rowCount() === 0) {
        jsonResponse(['success' => false, 'error' => 'Route not found or name unchanged'], 404);
    }
    
    jsonResponse(['success' => true, 'id' => $routeId, 'new_name' => $newName]);
}


// ==================== ФУНКЦИИ ОБРАБОТКИ ОСТАНОВОК ====================

/**
 * Добавить остановку к маршруту
 */
function addStop(): void {
    $input = getJsonInput();
    
    if (!isset($input['route_id']) || !isset($input['stop'])) {
        jsonResponse(['success' => false, 'error' => 'Parameters "route_id" and "stop" are required'], 400);
    }
    
    $routeId = (int)$input['route_id'];
    $stop = $input['stop'];
    
    if (!isset($stop['name']) || !isset($stop['lat']) || !isset($stop['lon'])) {
        jsonResponse(['success' => false, 'error' => 'Stop must have "name", "lat", and "lon"'], 400);
    }
    
    $name = trim($stop['name']);
    $lat = (float)$stop['lat'];
    $lon = (float)$stop['lon'];
    
    if (mb_strlen($name) < 2) {
        jsonResponse(['success' => false, 'error' => 'Stop name must be at least 2 characters'], 400);
    }
    
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        jsonResponse(['success' => false, 'error' => 'Invalid coordinates'], 400);
    }
    
    $db = getDb();
    
    // Проверяем существование маршрута
    $stmt = $db->prepare("SELECT id FROM routes WHERE id = ?");
    $stmt->execute([$routeId]);
    
    if (!$stmt->fetch()) {
        jsonResponse(['success' => false, 'error' => 'Route not found'], 404);
    }
    
    // Получаем следующий order_index
    $maxOrder = (int)$db->query("
        SELECT COALESCE(MAX(order_index), 0) + 1 as next_order
        FROM stops WHERE route_id = $routeId
    ")->fetch()['next_order'];
    
    // Вставляем остановку
    $stmt = $db->prepare("
        INSERT INTO stops (route_id, name, lat, lon, order_index)
        VALUES (?, ?, ?, ?, ?)
    ");
    $stmt->execute([$routeId, $name, $lat, $lon, $maxOrder]);
    
    jsonResponse([
        'success' => true,
        'id' => (int)$db->lastInsertId(),
        'order_index' => $maxOrder
    ], 201);
}

/**
 * Удалить остановку
 */
function deleteStop(): void {
    $input = getJsonInput();
    
    if (!isset($input['id']) || !is_numeric($input['id'])) {
        jsonResponse(['success' => false, 'error' => 'Parameter "id" is required'], 400);
    }
    
    $stopId = (int)$input['id'];
    $db = getDb();
    
    $stmt = $db->prepare("DELETE FROM stops WHERE id = ?");
    $stmt->execute([$stopId]);
    
    if ($stmt->rowCount() === 0) {
        jsonResponse(['success' => false, 'error' => 'Stop not found'], 404);
    }
    
    jsonResponse(['success' => true, 'deleted_id' => $stopId]);
}

/**
 * Изменить порядок остановки
 */
function reorderStop(): void {
    $input = getJsonInput();
    
    if (!validateRequiredParams(['id', 'order_index'], $input)) {
        jsonResponse(['success' => false, 'error' => 'Parameters "id" and "order_index" are required'], 400);
    }
    
    $stopId = (int)$input['id'];
    $newOrder = (int)$input['order_index'];
    
    $db = getDb();
    $stmt = $db->prepare("UPDATE stops SET order_index = ? WHERE id = ?");
    $stmt->execute([$newOrder, $stopId]);
    
    if ($stmt->rowCount() === 0) {
        jsonResponse(['success' => false, 'error' => 'Stop not found'], 404);
    }
    
    jsonResponse(['success' => true, 'id' => $stopId, 'new_order' => $newOrder]);
}


// ==================== ФУНКЦИИ ОБРАБОТКИ ТОЧЕК МАРШРУТА ====================

/**
 * Сохранить точки полилинии маршрута (заменяет старые)
 */
function saveRoutePoints(): void {
    $input = getJsonInput();
    
    if (!validateRequiredParams(['route_id', 'direction', 'points'], $input)) {
        jsonResponse(['success' => false, 'error' => 'Parameters "route_id", "direction", and "points" are required'], 400);
    }
    
    $routeId = (int)$input['route_id'];
    $direction = $input['direction'];
    $points = $input['points'];
    
    if (!in_array($direction, ['forward', 'backward'])) {
        jsonResponse(['success' => false, 'error' => 'Direction must be "forward" or "backward"'], 400);
    }
    
    if (!is_array($points) || count($points) < 2) {
        jsonResponse(['success' => false, 'error' => 'At least 2 points are required'], 400);
    }
    
    $db = getDb();
    
    // Проверяем существование маршрута
    $stmt = $db->prepare("SELECT id FROM routes WHERE id = ?");
    $stmt->execute([$routeId]);
    
    if (!$stmt->fetch()) {
        jsonResponse(['success' => false, 'error' => 'Route not found'], 404);
    }
    
    // Удаляем старые точки этого направления
    $db->prepare("DELETE FROM route_points WHERE route_id = ? AND direction = ?")
       ->execute([$routeId, $direction]);
    
    // Вставляем новые точки
    $stmt = $db->prepare("
        INSERT INTO route_points (route_id, direction, lat, lon, order_index)
        VALUES (?, ?, ?, ?, ?)
    ");
    
    foreach ($points as $index => $point) {
        if (!isset($point['lat']) || !isset($point['lon'])) {
            continue; // Пропускаем некорректные точки
        }
        
        $stmt->execute([
            $routeId,
            $direction,
            (float)$point['lat'],
            (float)$point['lon'],
            (int)($point['order_index'] ?? $index)
        ]);
    }
    
    jsonResponse([
        'success' => true,
        'route_id' => $routeId,
        'direction' => $direction,
        'points_count' => count($points)
    ]);
}

/**
 * Получить точки маршрута
 */
function getRoutePoints(): void {
    $routeId = (int)getRequestParam('route_id', 0);
    $direction = getRequestParam('direction', 'forward');
    
    if ($routeId <= 0) {
        jsonResponse(['success' => false, 'error' => 'Parameter "route_id" is required'], 400);
    }
    
    if (!in_array($direction, ['forward', 'backward'])) {
        jsonResponse(['success' => false, 'error' => 'Direction must be "forward" or "backward"'], 400);
    }
    
    $db = getDb();
    $points = $db->query("
        SELECT id, lat, lon, order_index
        FROM route_points 
        WHERE route_id = $routeId AND direction = '$direction'
        ORDER BY order_index ASC
    ")->fetchAll();
    
    jsonResponse([
        'success' => true,
        'route_id' => $routeId,
        'direction' => $direction,
        'points' => $points,
        'count' => count($points)
    ]);
}

/**
 * Удалить все точки маршрута
 */
function deleteRoutePoints(): void {
    $input = getJsonInput();
    
    if (!isset($input['route_id']) || !is_numeric($input['route_id'])) {
        jsonResponse(['success' => false, 'error' => 'Parameter "route_id" is required'], 400);
    }
    
    $routeId = (int)$input['route_id'];
    $db = getDb();
    
    $stmt = $db->prepare("DELETE FROM route_points WHERE route_id = ?");
    $stmt->execute([$routeId]);
    
    jsonResponse([
        'success' => true,
        'route_id' => $routeId,
        'deleted_count' => $stmt->rowCount()
    ]);
}


// ==================== ФУНКЦИИ ПРИВЯЗКИ ТС ====================

/**
 * Получить список ТС, привязанных к маршруту
 */
function getRouteVehicles(): void {
    $routeId = (int)getRequestParam('route_id', 0);
    
    if ($routeId <= 0) {
        jsonResponse(['success' => false, 'error' => 'Parameter "route_id" is required'], 400);
    }
    
    $db = getDb();
    $vehicles = $db->query("
        SELECT id, vehicle_id, vehicle_number
        FROM route_vehicles 
        WHERE route_id = $routeId
        ORDER BY vehicle_number ASC
    ")->fetchAll();
    
    jsonResponse([
        'success' => true,
        'route_id' => $routeId,
        'vehicles' => $vehicles,
        'count' => count($vehicles)
    ]);
}

/**
 * Привязать ТС к маршруту
 */
function bindVehicle(): void {
    $input = getJsonInput();
    
    if (!validateRequiredParams(['route_id', 'vehicle_id'], $input)) {
        jsonResponse(['success' => false, 'error' => 'Parameters "route_id" and "vehicle_id" are required'], 400);
    }
    
    $routeId = (int)$input['route_id'];
    $vehicleId = $input['vehicle_id'];
    $vehicleNumber = $input['vehicle_number'] ?? '';
    
    $db = getDb();
    
    try {
        $stmt = $db->prepare("
            INSERT OR IGNORE INTO route_vehicles (route_id, vehicle_id, vehicle_number)
            VALUES (?, ?, ?)
        ");
        $stmt->execute([$routeId, $vehicleId, $vehicleNumber]);
        
        if ($stmt->rowCount() === 0) {
            jsonResponse(['success' => false, 'error' => 'Vehicle already bound to this route'], 409);
        }
        
        jsonResponse([
            'success' => true,
            'route_id' => $routeId,
            'vehicle_id' => $vehicleId
        ], 201);
    } catch (PDOException $e) {
        logError('Bind vehicle error: ' . $e->getMessage(), [
            'route_id' => $routeId,
            'vehicle_id' => $vehicleId
        ]);
        jsonResponse(['success' => false, 'error' => 'Database error'], 500);
    }
}

/**
 * Отвязать ТС от маршрута
 */
function unbindVehicle(): void {
    $input = getJsonInput();
    
    if (!validateRequiredParams(['route_id', 'vehicle_id'], $input)) {
        jsonResponse(['success' => false, 'error' => 'Parameters "route_id" and "vehicle_id" are required'], 400);
    }
    
    $routeId = (int)$input['route_id'];
    $vehicleId = $input['vehicle_id'];
    
    $db = getDb();
    $stmt = $db->prepare("DELETE FROM route_vehicles WHERE route_id = ? AND vehicle_id = ?");
    $stmt->execute([$routeId, $vehicleId]);
    
    if ($stmt->rowCount() === 0) {
        jsonResponse(['success' => false, 'error' => 'Vehicle not bound to this route'], 404);
    }
    
    jsonResponse(['success' => true, 'route_id' => $routeId, 'vehicle_id' => $vehicleId]);
}


// ==================== ФУНКЦИИ ТРЕКОВ И РЕЙСОВ ====================

/**
 * Получить трек ТС (интеграция с PILOT API)
 */
function getVehicleTrack(): void {
    $vehicleId = getRequestParam('vehicle_id', '');
    $routeId = (int)getRequestParam('route_id', 0);
    $date = getRequestParam('date', date('Y-m-d'));
    
    if (empty($vehicleId) || $routeId <= 0) {
        jsonResponse(['success' => false, 'error' => 'Parameters "vehicle_id" and "route_id" are required'], 400);
    }
    
    // Валидация формата даты
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        jsonResponse(['success' => false, 'error' => 'Invalid date format. Use YYYY-MM-DD'], 400);
    }
    
    $db = getDb();
    
    // Получаем точки маршрута для генерации демо-трека
    $routePoints = $db->query("
        SELECT lat, lon FROM route_points 
        WHERE route_id = $routeId AND direction = 'forward'
        ORDER BY order_index ASC
    ")->fetchAll();
    
    if (empty($routePoints)) {
        jsonResponse([
            'success' => true,
            'track' => [],
            'trips_count' => 0,
            'vehicle_id' => $vehicleId,
            'message' => 'No route points found'
        ]);
    }
    
    // Генерируем демо-трек на основе точек маршрута
    $track = [];
    $baseTime = strtotime($date . ' 06:00:00');
    
    foreach ($routePoints as $i => $p) {
        // Добавляем небольшой случайный сдвиг для реалистичности
        $track[] = [
            'lat' => (float)$p['lat'] + (rand(-50, 50) / 100000),
            'lon' => (float)$p['lon'] + (rand(-50, 50) / 100000),
            'direction' => 'forward',
            'time' => date('H:i:s', $baseTime + ($i * 300)), // Каждые 5 минут
            'speed' => rand(20, 60),
            'order' => $i
        ];
    }
    
    jsonResponse([
        'success' => true,
        'track' => $track,
        'trips_count' => rand(3, 8),
        'vehicle_id' => $vehicleId,
        'route_id' => $routeId,
        'date' => $date,
        'points_count' => count($track)
    ]);
}

/**
 * Получить таймлайн рейсов маршрута
 */
function getTimeline(): void {
    $routeId = (int)getRequestParam('route_id', 0);
    $date = getRequestParam('date', date('Y-m-d'));
    
    if ($routeId <= 0) {
        jsonResponse(['success' => false, 'error' => 'Parameter "route_id" is required'], 400);
    }
    
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        jsonResponse(['success' => false, 'error' => 'Invalid date format'], 400);
    }
    
    // Генерируем демо-данные таймлайна (3:00 - 21:00)
    $hours = [];
    $trips = [];
    
    for ($h = 3; $h <= 21; $h++) {
        $hours[] = sprintf('%02d:00', $h);
        // Имитируем пиковые часы (7-9, 17-19)
        if (in_array($h, [7, 8, 9, 17, 18, 19])) {
            $trips[] = rand(4, 8);
        } else {
            $trips[] = rand(0, 3);
        }
    }
    
    jsonResponse([
        'success' => true,
        'route_id' => $routeId,
        'date' => $date,
        'timeline' => [
            'hours' => $hours,
            'trips' => $trips,
            'total_trips' => array_sum($trips),
            'peak_hours' => ['07:00-09:00', '17:00-19:00']
        ]
    ]);
}

/**
 * Подсчитать количество рейсов ТС за дату
 */
function countTrips(): void {
    $vehicleId = getRequestParam('vehicle_id', '');
    $date = getRequestParam('date', date('Y-m-d'));
    
    if (empty($vehicleId)) {
        jsonResponse(['success' => false, 'error' => 'Parameter "vehicle_id" is required'], 400);
    }
    
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        jsonResponse(['success' => false, 'error' => 'Invalid date format'], 400);
    }
    
    // Демо-данные: случайное количество рейсов
    $tripsCount = rand(3, 12);
    
    jsonResponse([
        'success' => true,
        'vehicle_id' => $vehicleId,
        'date' => $date,
        'trips_count' => $tripsCount,
        'average_trip_duration' => rand(45, 90) . ' min'
    ]);
}
