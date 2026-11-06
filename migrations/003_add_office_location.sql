-- ====================================================================
-- Migración 003: Soporte para Ubicación y Dirección de Oficinas
-- ====================================================================

-- Nota arquitectónica:
-- En la arquitectura actual, los usuarios y oficinas se gestionan a través
-- de Supabase Auth (auth.users), donde metadatos como el nombre de oficina
-- (display_name), estado (subscription_status) y rol se almacenan
-- nativamente en el objeto JSONB 'raw_user_meta_data'.
--
-- Al registrar una nueva oficina con su ubicación o dirección:
-- user_metadata -> {
--    "display_name": "Oficina Zoom",
--    "location": "Punto Fijo, Estado Falcón",
--    "subscription_status": "pending_approval",
--    "role": "operator"
-- }
--
-- Esta migración proporciona una vista de conveniencia e índice funcional
-- en el esquema público en caso de que desees consultar directamente las oficinas
-- y sus ubicaciones mediante SQL en Supabase Studio:

-- 1. Vista relacional de oficinas para facilitar consultas SQL y reportes
CREATE OR REPLACE VIEW public.offices_view AS
SELECT 
    id AS user_id,
    email,
    raw_user_meta_data->>'display_name' AS display_name,
    raw_user_meta_data->>'location' AS location,
    COALESCE(raw_user_meta_data->>'office_id', id::text) AS office_id,
    COALESCE(raw_user_meta_data->>'role', 'operator') AS role,
    COALESCE(raw_user_meta_data->>'subscription_status', 'pending_approval') AS status,
    created_at,
    last_sign_in_at
FROM auth.users;

-- Comentario explicativo
COMMENT ON VIEW public.offices_view IS 'Vista auxiliar para listar oficinas registradas junto con su ubicación geográfica y estado de suscripción';

