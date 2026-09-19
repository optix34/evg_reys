<?php
declare(strict_types=1);

// passenger_transit/backend/vehicles.php
// CRUD операции для привязки транспортных средств к маршрутам
// Strict compliance with AI_SPECS.md Rule 8.1 (PILOT Store Proxy URL Rules)

require_once __DIR__ . '/config.php';

/**
 * Получить список ТС, привязанных к конкретному маршруту
 * 
 * @param int $routeId ID маршрута
 * @return array Массив привязанных ТС
 */
function getVehiclesByRoute(int $routeId): array {
    $db = getDb();
    
    $stmt = $db->prepare("
        SELECT id, route_id, vehicle_id, vehicle_number
        FROM route_vehicles 
        WHERE route_id = ?
        ORDER BY vehicle_number ASC
    ");
    $stmt->execute([$routeId]);
    $vehicles = $stmt->fetchAll();
    
    // Приведение типов
    foreach ($vehicles as &$vehicle) {
        $vehicle['id'] = (int)$vehicle['id'];
        $vehicle['route_id'] = (int)$vehicle['route_id'];
    }
    
    return $vehicles;
}

/**
 * Привязать транспортное средство к маршруту
 * Использует INSERT OR IGNORE для безопасной обработки дубликатов 
 * (ограничение UNIQUE(route_id, vehicle_id) в схеме БД)
 * 
 * @param int $routeId ID маршрута
 * @param string $vehicleId ID объекта в PILOT (object_id)
 * @param string $vehicleNumber Госномер или название ТС
 * @return bool true если ТС было успешно привязано (или уже было привязано)
 * @throws PDOException
 */
function bindVehicleToRoute(int $routeId, string $vehicleId, string $vehicleNumber = ''): bool {
    $db = getDb();
    
    // Проверяем существование маршрута
    $stmt = $db->prepare("SELECT id FROM routes WHERE id = ?");
    $stmt->execute([$routeId]);
    if (!$stmt->fetch()) {
        throw new PDOException("Route with id $routeId not found");
    }
    
    // Привязываем ТС (игнорируем дубликаты)
    $stmt = $db->prepare("
        INSERT OR IGNORE INTO route_vehicles (route_id, vehicle_id, vehicle_number)
        VALUES (?, ?, ?)
    ");
    
    return $stmt->execute([$routeId, $vehicleId, $vehicleNumber]);
}

/**
 * Отвязать транспортное средство от маршрута
 * 
 * @param int $routeId ID маршрута
 * @param string $vehicleId ID объекта в PILOT
 * @return bool true если связь была удалена
 * @throws PDOException
 */
function unbindVehicleFromRoute(int $routeId, string $vehicleId): bool {
    $db = getDb();
    
    $stmt = $db->prepare("
        DELETE FROM route_vehicles 
        WHERE route_id = ? AND vehicle_id = ?
    ");
    $stmt->execute([$routeId, $vehicleId]);
    
    return $stmt->rowCount() > 0;
}

/**
 * Проверить, привязано ли ТС к маршруту
 * 
 * @param int $routeId ID маршрута
 * @param string $vehicleId ID объекта в PILOT
 * @return bool true если ТС уже привязано
 */
function isVehicleBoundToRoute(int $routeId, string $vehicleId): bool {
    $db = getDb();
    
    $stmt = $db->prepare("
        SELECT COUNT(*) as cnt 
        FROM route_vehicles 
        WHERE route_id = ? AND vehicle_id = ?
    ");
    $stmt->execute([$routeId, $vehicleId]);
    
    return (int)$stmt->fetch()['cnt'] > 0;
}

/**
 * Получить список маршрутов, к которым привязано конкретное ТС
 * Полезно для UI: показать диспетчеру, где еще работает эта машина
 * 
 * @param string $vehicleId ID объекта в PILOT
 * @return array Массив маршрутов
 */
function getRoutesByVehicle(string $vehicleId): array {
    $db = getDb();
    
    $stmt = $db->prepare("
        SELECT rv.id, rv.route_id, rv.vehicle_number, r.name as route_name
        FROM route_vehicles rv
        JOIN routes r ON r.id = rv.route_id
        WHERE rv.vehicle_id = ?
        ORDER BY r.name ASC
    ");
    $stmt->execute([$vehicleId]);
    $routes = $stmt->fetchAll();
    
    foreach ($routes as &$route) {
        $route['id'] = (int)$route['id'];
        $route['route_id'] = (int)$route['route_id'];
    }
    
    return $routes;
}

/**
 * Массовая отвязка всех ТС от маршрута
 * Используется при очистке маршрута или его архивации
 * 
 * @param int $routeId ID маршрута
 * @return int Количество отвязанных ТС
 * @throws PDOException
 */
function unbindAllVehiclesFromRoute(int $routeId): int {
    $db = getDb();
    
    $stmt = $db->prepare("DELETE FROM route_vehicles WHERE route_id = ?");
    $stmt->execute([$routeId]);
    
    return $stmt->rowCount();
}

/**
 * Обновить номер/название ТС во всех привязках
 * Используется, если в PILOT изменился госномер объекта
 * 
 * @param string $vehicleId ID объекта в PILOT
 * @param string $newNumber Новый номер
 * @return int Количество обновленных записей
 */
function updateVehicleNumber(string $vehicleId, string $newNumber): int {
    $db = getDb();
    
    $stmt = $db->prepare("
        UPDATE route_vehicles 
        SET vehicle_number = ? 
        WHERE vehicle_id = ?
    ");
    $stmt->execute([$newNumber, $vehicleId]);
    
    return $stmt->rowCount();
}
