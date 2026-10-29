-- ====================================================================
-- Migración 001: Esquema Base (Tablas guides y user_sessions)
-- ====================================================================

-- 1. Tabla de Guías de Envío
CREATE TABLE IF NOT EXISTS public.guides (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    owner TEXT,
    service_type TEXT DEFAULT '—',
    has_payment BOOLEAN DEFAULT NULL,
    delivered BOOLEAN DEFAULT FALSE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    office_id TEXT NOT NULL DEFAULT 'default',
    user_id TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para optimizar consultas de guías por oficina, código y fecha
CREATE INDEX IF NOT EXISTS idx_guides_office_timestamp 
    ON public.guides(office_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_guides_code 
    ON public.guides(code);

CREATE INDEX IF NOT EXISTS idx_guides_office_delivered 
    ON public.guides(office_id, delivered);

-- 2. Tabla de Sesiones de Usuario Multi-dispositivo (Refresh Tokens)
CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    refresh_token_hash TEXT NOT NULL,
    device_info TEXT DEFAULT 'Unknown Device',
    ip_address TEXT DEFAULT 'Unknown IP',
    remember_me BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE
);

-- Índices para búsqueda rápida por hash de token y usuario
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_hash 
    ON public.user_sessions(refresh_token_hash)
    WHERE is_revoked = FALSE;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id 
    ON public.user_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at 
    ON public.user_sessions(expires_at);

-- Comentarios explicativos
COMMENT ON TABLE public.guides IS 'Almacén de guías de despacho escaneadas o importadas por oficina';
COMMENT ON TABLE public.user_sessions IS 'Registro de sesiones multi-dispositivo y refresh tokens rotativos';

