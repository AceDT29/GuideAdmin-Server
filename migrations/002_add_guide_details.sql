-- ====================================================================
-- Migración: Nuevos campos de manifiesto y estado de entrega
-- ====================================================================

ALTER TABLE public.guides
    ADD COLUMN IF NOT EXISTS owner TEXT,
    ADD COLUMN IF NOT EXISTS service_type TEXT DEFAULT '—',
    ADD COLUMN IF NOT EXISTS has_payment BOOLEAN DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS delivered BOOLEAN DEFAULT FALSE;

-- Índice para optimizar consultas de guías pendientes vs entregadas por oficina
CREATE INDEX IF NOT EXISTS idx_guides_office_delivered 
    ON public.guides(office_id, delivered);

-- Comentarios explicativos en el catálogo de PostgreSQL
COMMENT ON COLUMN public.guides.owner IS 'Nombre del dueño o destinatario extraído de la Hoja de Ruta Zoom';
COMMENT ON COLUMN public.guides.service_type IS 'Código del servicio Zoom (ej: BCD, GP6, BGN)';
COMMENT ON COLUMN public.guides.has_payment IS 'True si tiene cobro en USD/Bs, False si es prepagado, NULL si no especificado';
COMMENT ON COLUMN public.guides.delivered IS 'True si el operador marcó el paquete como entregado';
