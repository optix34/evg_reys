<?php
declare(strict_types=1);

// passenger_transit/backend/route_points.php
// CRUD операции для точек полилинии маршрута (прямое и обратное направление)
// Strict compliance with AI_SPECS.md Rule 8.1 (PILOT Store Proxy URL Rules)

require_once __DIR__ . '/config.php';

/**
 * Допустимые значения направления маршрута
 */
const VALID_DIRECTIONS = ['forward', 'backward'];

/**
 * Получить точки маршрута по направлению
 * Возвращает массив точек, отсортированный по order_index
 * 
 * @param int $routeId ID маршрута
 * @param string $direction Направление ('forward' или 'backward')
 * @return array Массив точек маршрута
 */
function getRoutePoints(int $routeId, string $direction): array {
    if (!in_array($direction, VALID_DIRECTIONS, true)) {
        return [];
    }
    
    $db = getDb();
    
    $stmt = $db->prepare("
        SELECT id, route_id, direction, lat, lon, order_index
        FROM route_points 
        WHERE route_id = ? AND direction = ?
        ORDER BY order_index ASC
    ");
    $stmt->execute([$routeId, $direction]);
    $points = $stmt->fetchAll();
    
    // Приведение типов для корректной сериализации в JSON
    foreach ($points as &$point) {
        $point['id'] = (int)$point['id'];
        $point['route_id'] = (int)$point['route_id'];
        $point['lat'] = (float)$point['lat'];
        $point['lon'] = (float)$point['lon'];
        $point['order_index'] = (int)$point['order_index'];
    }
    
    return $points;
}

/**
 * Сохранить точки маршрута (полная замена старых точек направления)
 * Используется при редактировании маршрута через редактор полилинии
 * 
 * @param int $routeId ID маршрута
 * @param string $direction Направление ('forward' или 'backward')
 * @param array $points Массив точек с полями lat, lon, order_index
 * @return int Количество сохраненных точек
 * @throws PDOException
 */
function saveRoutePointsData(int $routeId, string $direction, array $points): int {
    if (!in_array($direction, VALID_DIRECTIONS, true)) {
        throw new PDOException("Invalid direction: $direction");
    }
    
    if (empty($points)) {
        return 0;
    }
    
    $db = getDb();
    
    // Проверяем существование маршрута
    $stmt = $db->prepare("SELECT id FROM routes WHERE id = ?");
    $stmt->execute([$routeId]);
    if (!$stmt->fetch()) {
        throw new PDOException("Route with id $routeId not found");
    }
    
    // Начинаем транзакцию для атомарности операции
    $db->beginTransaction();
    
    try {
        // Удаляем старые точки этого направления
        $stmt = $db->prepare("DELETE FROM route_points WHERE route_id = ? AND direction = ?");
        $stmt->execute([$routeId, $direction]);
        
        // Вставляем новые точки
        $stmt = $db->prepare("
            INSERT INTO route_points (route_id, direction, lat, lon, order_index)
            VALUES (?, ?, ?, ?, ?)
        ");
        
        $count = 0;
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
            $count++;
        }
        
        $db->commit();
        return $count;
    } catch (PDOException $e) {
        $db->rollBack();
        throw $e;
    }
}

/**
 * Удалить все точки маршрута (оба направления)
 * Обычно используется при удалении маршрута
 * 
 * @param int $routeId ID маршрута
 * @return int Количество удаленных точек
 * @throws PDOException
 */
function deleteRoutePoints(int $routeId): int {
    $db = getDb();
    
    $stmt = $db->prepare("DELETE FROM route_points WHERE route_id = ?");
    $stmt->execute([$routeId]);
    
    return $stmt->rowCount();
}

/**
 * Удалить точки маршрута только одного направления
 * 
 * @param int $routeId ID маршрута
 * @param string $direction Направление ('forward' или 'backward')
 * @return int Количество удаленных точек
 * @throws PDOException
 */
function deleteRoutePointsByDirection(int $routeId, string $direction): int {
    if (!in_array($direction, VALID_DIRECTIONS, true)) {
        throw new PDOException("Invalid direction: $direction");
    }
    
    $db = getDb();
    
    $stmt = $db->prepare("DELETE FROM route_points WHERE route_id = ? AND direction = ?");
    $stmt->execute([$routeId, $direction]);
    
    return $stmt->rowCount();
}

/**
 * Получить одну точку маршрута по ID
 * 
 * @param int $id ID точки
 * @return array|null Данные точки или null если не найдена
 */
function getRoutePointById(int $id): ?array {
    $db = getDb();
    
    $stmt = $db->prepare("
        SELECT id, route_id, direction, lat, lon, order_index
        FROM route_points 
        WHERE id = ?
    ");
    $stmt->execute([$id]);
    $point = $stmt->fetch();
    
    if (!$point) {
        return null;
    }
    
    // Приведение типов
    $point['id'] = (int)$point['id'];
    $point['route_id'] = (int)$point['route_id'];
    $point['lat'] = (float)$point['lat'];
    $point['lon'] = (float)$point['lon'];
    $point['order_index'] = (int)$point['order_index'];
    
    return $point;
}

/**
 * Получить количество точек маршрута по направлению
 * 
 * @param int $routeId ID маршрута
 * @param string $direction Направление ('forward' или 'backward')
 * @return int Количество точек
 */
function getRoutePointsCount(int $routeId, string $direction): int {
    if (!in_array($direction, VALID_DIRECTIONS, true)) {
        return 0;
    }
    
    $db = getDb();
    
    $stmt = $db->prepare("
        SELECT COUNT(*) as cnt 
        FROM route_points 
        WHERE route_id = ? AND direction = ?
    ");
    $stmt->execute([$routeId, $direction]);
    
    return (int)$stmt->fetch()['cnt'];
}

/**
 * Получить общее количество точек маршрута (оба направления)
 * 
 * @param int $routeId ID маршрута
 * @return int Общее количество точек
 */
function getTotalRoutePointsCount(int $routeId): int {
    $db = getDb();
    
    $stmt = $db->prepare("
        SELECT COUNT(*) as cnt 
        FROM route_points 
        WHERE route_id = ?
    ");
    $stmt->execute([$routeId]);
    
    return (int)$stmt->fetch()['cnt'];
}

/**
 * Проверить, имеет ли маршрут точки полилинии
 * 
 * @param int $routeId ID маршрута
 * @return bool true если маршрут имеет хотя бы одну точку
 */
function routeHasPoints(int $routeId): bool {
    return getTotalRoutePointsCount($routeId) > 0;
}

/**
 * Получить точки маршрута в формате GeoJSON
 * Удобно для интеграции с Leaflet и другими картографическими библиотеками
 * 
 * @param int $routeId ID маршрута
 * @param string $direction Направление ('forward' или 'backward')
 * @return array GeoJSON FeatureCollection
 */
function getRoutePointsAsGeoJSON(int $routeId, string $direction): array {
    $points = getRoutePoints($routeId, $direction);
    
    if (empty($points)) {
        return [
            'type' => 'FeatureCollection',
            'features' => []
        ];
    }
    
    $features = [];
    foreach ($points as $point) {
        $features[] = [
            'type' => 'Feature',
            'geometry' => [
                'type' => 'Point',
                'coordinates' => [$point['lon'], $point['lat']] // GeoJSON использует [lon, lat]
            ],
            'properties' => [
                'id' => $point['id'],
                'order_index' => $point['order_index'],
                'direction' => $point['direction']
            ]
        ];
    }
    
    return [
        'type' => 'FeatureCollection',
        'features' => $features
    ];
}
