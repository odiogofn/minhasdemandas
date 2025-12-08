# backend_r2.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import uuid
from werkzeug.utils import secure_filename
import boto3
from botocore.client import Config

app = Flask(__name__)
CORS(app)  # libera para seu front (pode restringir depois por origem)

# ====== CONFIG R2 ======
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME")
# Ex: "https://meu-bucket.meudominio.com" OU "https://pub-xxxxxxxx.r2.dev"
R2_PUBLIC_BASE_URL = os.environ.get("R2_PUBLIC_BASE_URL")

if not all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL]):
    raise RuntimeError("Configure as variáveis de ambiente do R2.")

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)

@app.route("/r2/presign", methods=["POST"])
def r2_presign():
    """
    Recebe: { "filename": "print.png", "contentType": "image/png" }
    Retorna: { "uploadUrl", "publicUrl", "key" }
    """
    data = request.get_json() or {}
    filename = data.get("filename")
    content_type = data.get("contentType") or "application/octet-stream"

    if not filename:
        return jsonify({"error": "filename obrigatório"}), 400

    safe_name = secure_filename(filename)
    key = f"prints/{uuid.uuid4().hex}_{safe_name}"

    try:
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": R2_BUCKET_NAME,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=3600,  # 1h pra subir o arquivo
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Monta URL pública (depende de como você configurou o bucket/DOMÍNIO)
    # R2_PUBLIC_BASE_URL exemplo: "https://meu-bucket.meudominio.com"
    if R2_PUBLIC_BASE_URL.endswith("/"):
        public_url = f"{R2_PUBLIC_BASE_URL}{key}"
    else:
        public_url = f"{R2_PUBLIC_BASE_URL}/{key}"

    return jsonify({
        "uploadUrl": upload_url,
        "publicUrl": public_url,
        "key": key,
    })


@app.route("/")
def health():
    return "R2 backend OK", 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))