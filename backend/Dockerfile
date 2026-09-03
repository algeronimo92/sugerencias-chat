FROM python:3.12-slim

WORKDIR /app

# ffmpeg: recomprime los videos que superan el límite antes de enviarlos
# (services/media_storage.compress_video) y convierte las notas de voz
# grabadas en el navegador a Ogg/Opus, el único formato que Meta Cloud API
# reproduce como PTT (services/media_storage.transcode_audio_to_ogg_opus).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
