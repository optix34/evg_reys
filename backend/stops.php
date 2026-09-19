<?php
declare(strict_types=1);

// passenger_transit/backend/stops.php
// CRUD операции для остановок маршрута
// Strict compliance with AI_SPECS.md Rule 8.1 (PILOT Store Proxy URL Rules)

require_once __DIR__ . '/config.php';

/**
 * Получить все остановки конкретного маршрута
 * Возвращает массив остановок, отсортированный по order_index
 * 
 * @param int $routeId ID маршрута
 * @return array Массив остановок
 */
function getStopsByRoute(int $routeId): array {
    $db = getDb();
    
    $stmt = $db->prepare("
        SELECT id, route_id, name, lat, lon, order_index
        FROM stops 
        WHERE route_id = ?
        ORDER BY order_index ASC
    ");
    $stmt->execute([$routeId]);
    $stops = $stmt->fetchAll();
    
    // Приведение типов для корректной сериализации в JSON
    foreach ($stops as &$stop) {
        $stop['id'] = (int)$stop['id'];
        $stop['route_id'] = (int)$stop['route_id'];
        $stop['lat'] = (float)$stop['lat'];
        $stop['lon'] = (float)$stop['lon'];
        $stop['order_index'] = (int)$stop['order_index'];
    }
    
    return $stops;
}

/**
 * Добавить новую остановку к маршруту
 * Автоматически вычисляет следующий order_index (добавляет в конец списка)
 * 
 * @param int $routeId ID маршрута
 * @param string $name Название остановки
 * @param float $lat Широта
 * @param float $lon Долгота
 * @return int ID созданной остановки
 * @throws PDOException
 */
function addNewStop(int $routeId, string $name, float $lat, float $lon): int {
    $db = getDb();
    
    // Проверяем существование маршрута
    $stmt = $db->prepare("SELECT id FROM routes WHERE id = ?");
    $stmt->execute([$routeId]);
    if (!$stmt->fetch()) {
        throw new PDOException("Route with id $routeId not found");
    }
    
    // Вычисляем следующий порядковый номер
    $stmt = $db->prepare("
        SELECT COALESCE(MAX(order_index), 0) + 1 as next_order 
        FROM stops 
        WHERE route_id = ?
    ");
    $stmt->execute([$routeId]);
    $nextOrder = (int)$stmt->fetch()['next_order'];
    
    // Вставляем остановку
    $stmt = $db->prepare("
        INSERT INTO stops (route_id, name, lat, lon, order_index)
        VALUES (?, ?, ?, ?, ?)
    ");
    $stmt->execute([$routeId, $name, $lat, $lon, $nextOrder]);
    
    return (int)$db->lastInsertId();
}

/**
 * Удалить остановку
 * 
 * @param int $id ID остановки
 * @return bool true если остановка была удалена
 * @throws PDOException
 */
function deleteStop(int $id): bool {
    $db = getDb();
    
    $stmt = $db->prepare("DELETE FROM stops WHERE id = ?");
    $stmt->execute([$id]);
    
    return $stmt->rowCount() > 0;
}

/**
 * Изменить порядковый номер остановки (перемещение в списке)
 * 
 * @param int $id ID остановки
 * @param int $newOrder Новый порядковый номер
 * @return bool true если порядок был изменен
 * @throws PDOException
 */
function reorderStop(int $id, int $newOrder): bool {
    $db = getDb();
    
    $stmt = $db->prepare("UPDATE stops SET order_index = ? WHERE id = ?");
    $stmt->execute([$newOrder, $id]);
    
    return $stmt->rowCount() > 0;
}

/**
 * Обновить данные остановки (название и координаты)
 * 
 * @param int $id ID остановки
 * @param string $name Новое название
 * @param float $lat Новая широта
 * @param float $lon Новая долгота
 * @return bool true если данные были обновлены
 * @throws PDOException
 */
function updateStop(int $id, string $name, float $lat, float $lon): bool {
    $db = getDb();
    
    $stmt = $db->prepare("
        UPDATE stops 
        SET name = ?, lat = ?, lon = ? 
        WHERE id = ?
    ");
    $stmt->execute([$name, $lat, $lon, $id]);
    
    return $stmt->rowCount() > 0;
}

/**
 * Получить одну остановку по ID
 * 
 * @param int $id ID остановки
 * @return array|null Данные остановки или null если не найдена
 */
function getStopById(int $id): ?array {
    $db = getDb();
    
    $stmt = $db->prepare("
        SELECT id, route_id, name, lat, lon, order_index
        FROM stops 
        WHERE id = ?
    ");
    $stmt->execute([$id]);
    $stop = $stmt->fetch();
    
    if (!$stop) {
        return null;
    }
    
    // Приведение типов
    $stop['id'] = (int)$stop['id'];
    $stop['route_id'] = (int)$stop['route_id'];
    $stop['lat'] = (float)$stop['lat'];
    $stop['lon'] = (float)$stop['lon'];
    $stop['order_index'] = (int)$stop['order_index'];
    
    return $stop;
}

/**
 * Удалить все остановки маршрута
 * Обычно используется перед массовым импортом или удалением маршрута
 * 
 * @param int $routeId ID маршрута
 * @return int Количество удаленных остановок
 * @throws PDOException
 */
function deleteStopsByRoute(int $routeId): int {
    $db = getDb();
    
    $stmt = $db->prepare("DELETE FROM stops WHERE route_id = ?");
    $stmt->execute([$routeId]);
    
    return $stmt->rowCount();
}
