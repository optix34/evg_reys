<?php
declare(strict_types=1);

// passenger_transit/backend/routes.php
// CRUD операции для маршрутов
// Strict compliance with AI_SPECS.md Rule 8.1 (PILOT Store Proxy URL Rules)

require_once __DIR__ . '/config.php';

/**
 * Получить все маршруты с полной информацией
 * Возвращает массив маршрутов с вложенными остановками, точками и статистикой
 * 
 * @return array Массив маршрутов
 */
function getAllRoutes(): array {
    $db = getDb();
    
    // Получаем базовую информацию о маршрутах
    $routes = $db->query("
        SELECT 
            r.id, 
            r.name, 
            r.created_at,
            (SELECT COUNT(*) FROM route_vehicles WHERE route_id = r.id) as vehicle_count,
            (SELECT COUNT(*) FROM stops WHERE route_id = r.id) as stop_count,
            (SELECT COUNT(*) FROM route_points WHERE route_id = r.id AND direction = 'forward') as forward_points_count,
            (SELECT COUNT(*) FROM route_points WHERE route_id = r.id AND direction = 'backward') as backward_points_count
        FROM routes r
        ORDER BY r.name ASC
    ")->fetchAll();
    
    // Для каждого маршрута загружаем связанные данные
    foreach ($routes as &$route) {
        $routeId = (int)$route['id'];
        
        // Остановки маршрута
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
        
        // Привязанные ТС
        $route['vehicles'] = $db->query("
            SELECT id, vehicle_id, vehicle_number
            FROM route_vehicles 
            WHERE route_id = $routeId
            ORDER BY vehicle_number ASC
        ")->fetchAll();
        
        // Приводим числовые поля к правильным типам
        $route['id'] = (int)$route['id'];
        $route['vehicle_count'] = (int)$route['vehicle_count'];
        $route['stop_count'] = (int)$route['stop_count'];
        $route['forward_points_count'] = (int)$route['forward_points_count'];
        $route['backward_points_count'] = (int)$route['backward_points_count'];
        
        foreach ($route['stops'] as &$stop) {
            $stop['id'] = (int)$stop['id'];
            $stop['lat'] = (float)$stop['lat'];
            $stop['lon'] = (float)$stop['lon'];
            $stop['order_index'] = (int)$stop['order_index'];
        }
        
        foreach ($route['forward_points'] as &$point) {
            $point['id'] = (int)$point['id'];
            $point['lat'] = (float)$point['lat'];
            $point['lon'] = (float)$point['lon'];
            $point['order_index'] = (int)$point['order_index'];
        }
        
        foreach ($route['backward_points'] as &$point) {
            $point['id'] = (int)$point['id'];
            $point['lat'] = (float)$point['lat'];
            $point['lon'] = (float)$point['lon'];
            $point['order_index'] = (int)$point['order_index'];
        }
        
        foreach ($route['vehicles'] as &$vehicle) {
            $vehicle['id'] = (int)$vehicle['id'];
        }
    }
    
    return $routes;
}

/**
 * Создать новый маршрут
 * 
 * @param string $name Название маршрута
 * @return int ID созданного маршрута
 * @throws PDOException
 */
function createNewRoute(string $name): int {
    $db = getDb();
    
    $stmt = $db->prepare("INSERT INTO routes (name) VALUES (?)");
    $stmt->execute([$name]);
    
    return (int)$db->lastInsertId();
}

/**
 * Удалить маршрут и все связанные данные
 * Благодаря FOREIGN KEY ON DELETE CASCADE, удаляются:
 * - остановки (stops)
 * - точки маршрута (route_points)
 * - привязанные ТС (route_vehicles)
 * 
 * @param int $id ID маршрута
 * @return bool true если маршрут был удален
 * @throws PDOException
 */
function deleteRoute(int $id): bool {
    $db = getDb();
    
    $stmt = $db->prepare("DELETE FROM routes WHERE id = ?");
    $stmt->execute([$id]);
    
    return $stmt->rowCount() > 0;
}

/**
 * Переименовать маршрут
 * 
 * @param int $id ID маршрута
 * @param string $newName Новое название
 * @return bool true если название было изменено
 * @throws PDOException
 */
function renameRoute(int $id, string $newName): bool {
    $db = getDb();
    
    $stmt = $db->prepare("UPDATE routes SET name = ? WHERE id = ?");
    $stmt->execute([$newName, $id]);
    
    return $stmt->rowCount() > 0;
}

/**
 * Получить маршрут по ID с полной информацией
 * 
 * @param int $id ID маршрута
 * @return array|null Данные маршрута или null если не найден
 */
function getRouteById(int $id): ?array {
    $db = getDb();
    
    $route = $db->query("
        SELECT 
            r.id, 
            r.name, 
            r.created_at,
            (SELECT COUNT(*) FROM route_vehicles WHERE route_id = r.id) as vehicle_count,
            (SELECT COUNT(*) FROM stops WHERE route_id = r.id) as stop_count
        FROM routes r
        WHERE r.id = $id
    ")->fetch();
    
    if (!$route) {
        return null;
    }
    
    $routeId = (int)$route['id'];
    
    // Загружаем связанные данные
    $route['stops'] = $db->query("
        SELECT id, name, lat, lon, order_index
        FROM stops 
        WHERE route_id = $routeId
        ORDER BY order_index ASC
    ")->fetchAll();
    
    $route['forward_points'] = $db->query("
        SELECT id, lat, lon, order_index
        FROM route_points 
        WHERE route_id = $routeId AND direction = 'forward'
        ORDER BY order_index ASC
    ")->fetchAll();
    
    $route['backward_points'] = $db->query("
        SELECT id, lat, lon, order_index
        FROM route_points 
        WHERE route_id = $routeId AND direction = 'backward'
        ORDER BY order_index ASC
    ")->fetchAll();
    
    $route['vehicles'] = $db->query("
        SELECT id, vehicle_id, vehicle_number
        FROM route_vehicles 
        WHERE route_id = $routeId
        ORDER BY vehicle_number ASC
    ")->fetchAll();
    
    // Приводим типы
    $route['id'] = (int)$route['id'];
    $route['vehicle_count'] = (int)$route['vehicle_count'];
    $route['stop_count'] = (int)$route['stop_count'];
    
    return $route;
}

/**
 * Проверить существование маршрута
 * 
 * @param int $id ID маршрута
 * @return bool true если маршрут существует
 */
function routeExists(int $id): bool {
    $db = getDb();
    
    $stmt = $db->prepare("SELECT COUNT(*) as cnt FROM routes WHERE id = ?");
    $stmt->execute([$id]);
    
    return (int)$stmt->fetch()['cnt'] > 0;
}

/**
 * Получить статистику по всем маршрутам
 * 
 * @return array Статистика
 */
function getRoutesStatistics(): array {
    $db = getDb();
    
    $stats = $db->query("
        SELECT 
            COUNT(*) as total_routes,
            (SELECT COUNT(*) FROM stops) as total_stops,
            (SELECT COUNT(*) FROM route_points) as total_points,
            (SELECT COUNT(*) FROM route_vehicles) as total_vehicles
        FROM routes
    ")->fetch();
    
    return [
        'total_routes' => (int)$stats['total_routes'],
        'total_stops' => (int)$stats['total_stops'],
        'total_points' => (int)$stats['total_points'],
        'total_vehicles' => (int)$stats['total_vehicles']
    ];
}
