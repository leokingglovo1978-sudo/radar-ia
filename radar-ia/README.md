# Radar IA — Detector de negocios que necesitan IA

## Setup (10 minutos)

1. Clona/abre esta carpeta en Cursor
2. Crea un entorno virtual e instala dependencias:
   ```bash
   python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. Prueba el pipeline SIN APIs (modo demo):
   ```bash
   python src/pipeline.py demo
   ```
   Esto corre el motor completo con datos de muestra y genera `data/leads.csv`.

4. Cuando estés listo, consigue tus claves:
   - Google Places API: https://console.cloud.google.com  (activa "Places API")
   - OpenAI API: https://platform.openai.com
   Pégalas en `.env` (copia `.env.example`).

5. Extracción real:
   ```bash
   python src/pipeline.py extract "dentistas en Madrid" --max 20
   python src/pipeline.py analyze        # analiza reseñas con IA
   python src/pipeline.py score          # puntúa y exporta leads
   ```

## Estructura
- `src/extract.py`  → Google Places API (negocios + reseñas)
- `src/analyze.py`  → LLM: detecta 'no contestan' en reseñas
- `src/score.py`    → motor de scoring (la lógica del radar)
- `src/db.py`       → SQLite (cero configuración; migramos a Supabase luego)
- `src/pipeline.py` → orquestador con comandos
- `data/radar.db`   → tu base de datos local
- `data/leads.csv`  → leads calientes exportados
