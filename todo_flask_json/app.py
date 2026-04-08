from flask import Flask, jsonify, render_template, request
from datetime import datetime, timezone
import json
import os
import threading
import uuid

app = Flask(__name__)

DATA_FILE = "tasks.json"
MAX_TEXT_LEN = 100
LOCK = threading.Lock()

ALLOWED_PRIORITIES = {"low", "medium", "high"}


def now_iso() -> str:
    """Retorna timestamp ISO em UTC."""
    return datetime.now(timezone.utc).isoformat()


def normalize_text(text: str) -> str:
    """Remove espaços extras e normaliza quebras."""
    return " ".join(text.strip().split())


def safe_load_tasks() -> list:
    """
    Lê tasks do JSON com tolerância a erro.
    Se o arquivo estiver corrompido, cria backup e recomeça com lista vazia.
    """
    if not os.path.exists(DATA_FILE):
        return []

    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, list):
            raise ValueError("Formato inválido: esperado lista de tarefas.")

        normalized = []
        for t in data:
            if not isinstance(t, dict):
                continue

            text = normalize_text(str(t.get("text", "")))
            if not text:
                continue

            priority = t.get("priority", "medium")
            if priority not in ALLOWED_PRIORITIES:
                priority = "medium"

            created_at = t.get("created_at") or now_iso()
            updated_at = t.get("updated_at") or created_at

            normalized.append({
                "id": str(t.get("id", uuid.uuid4().hex)),
                "text": text,
                "completed": bool(t.get("completed", False)),
                "priority": priority,
                "created_at": created_at,
                "updated_at": updated_at,
            })

        # Ordena por data de criação (mais recente primeiro)
        normalized.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return normalized

    except Exception:
        # Se deu erro ao ler/parsear, faz backup e recomeça
        try:
            corrupted_name = f"{DATA_FILE}.corrupted.{int(datetime.now(timezone.utc).timestamp())}"
            os.replace(DATA_FILE, corrupted_name)
        except Exception:
            pass
        return []


def safe_write_tasks(tasks: list) -> None:
    """
    Escrita atômica: salva em arquivo temporário e depois substitui o original.
    Evita corromper o JSON em caso de queda.
    """
    tmp_file = DATA_FILE + ".tmp"
    try:
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(tasks, f, ensure_ascii=False, indent=2)
        os.replace(tmp_file, DATA_FILE)
    finally:
        # Se sobrar tmp por algum motivo, tenta apagar
        try:
            if os.path.exists(tmp_file):
                os.remove(tmp_file)
        except Exception:
            pass


def is_duplicate(text: str, tasks: list, exclude_id: str | None = None) -> bool:
    """Evita duplicidade case-insensitive e ignorando o próprio item (edição)."""
    candidate = normalize_text(text).lower()

    for t in tasks:
        if exclude_id and t.get("id") == exclude_id:
            continue
        if normalize_text(t.get("text", "")).lower() == candidate:
            return True

    return False


def validate_task_payload(payload: dict, tasks: list, *, exclude_id: str | None = None):
    """Valida texto/prioridade e retorna (ok, erro|dados_limpos)."""
    text = payload.get("text", "")
    if not isinstance(text, str):
        return False, "O texto da tarefa deve ser uma string."

    text = normalize_text(text)
    if not text:
        return False, "Não é permitido criar uma tarefa vazia."
    if len(text) > MAX_TEXT_LEN:
        return False, f"Tarefa muito longa. Máximo permitido: {MAX_TEXT_LEN} caracteres."
    if is_duplicate(text, tasks, exclude_id=exclude_id):
        return False, "Essa tarefa já existe (duplicada)."

    priority = payload.get("priority", "medium")
    if priority not in ALLOWED_PRIORITIES:
        return False, "Prioridade inválida."

    return True, {"text": text, "priority": priority}


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/tasks")
def list_tasks():
    with LOCK:
        tasks = safe_load_tasks()
    return jsonify({"ok": True, "tasks": tasks})


@app.post("/api/tasks")
def create_task():
    payload = request.get_json(silent=True) or {}

    with LOCK:
        tasks = safe_load_tasks()
        valid, result = validate_task_payload(payload, tasks)
        if not valid:
            return jsonify({"ok": False, "message": result}), 400

        task = {
            "id": uuid.uuid4().hex,
            "text": result["text"],
            "completed": False,
            "priority": result["priority"],
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }

        tasks.insert(0, task)  # mais recente primeiro
        safe_write_tasks(tasks)

    return jsonify({"ok": True, "message": "Tarefa adicionada com sucesso!", "task": task}), 201


@app.put("/api/tasks/<task_id>")
def update_task(task_id):
    payload = request.get_json(silent=True) or {}

    with LOCK:
        tasks = safe_load_tasks()
        task = next((t for t in tasks if t["id"] == task_id), None)
        if not task:
            return jsonify({"ok": False, "message": "Tarefa não encontrada."}), 404

        valid, result = validate_task_payload(payload, tasks, exclude_id=task_id)
        if not valid:
            return jsonify({"ok": False, "message": result}), 400

        task["text"] = result["text"]
        task["priority"] = result["priority"]
        task["updated_at"] = now_iso()

        safe_write_tasks(tasks)

    return jsonify({"ok": True, "message": "Tarefa atualizada!", "task": task})


@app.patch("/api/tasks/<task_id>/toggle")
def toggle_task(task_id):
    with LOCK:
        tasks = safe_load_tasks()
        task = next((t for t in tasks if t["id"] == task_id), None)
        if not task:
            return jsonify({"ok": False, "message": "Tarefa não encontrada."}), 404

        task["completed"] = not task["completed"]
        task["updated_at"] = now_iso()

        safe_write_tasks(tasks)

    return jsonify({"ok": True, "message": "Status atualizado!", "task": task})


@app.delete("/api/tasks/<task_id>")
def delete_task(task_id):
    with LOCK:
        tasks = safe_load_tasks()
        idx = next((i for i, t in enumerate(tasks) if t["id"] == task_id), None)
        if idx is None:
            return jsonify({"ok": False, "message": "Tarefa não encontrada."}), 404

        removed = tasks.pop(idx)
        safe_write_tasks(tasks)

    return jsonify({"ok": True, "message": "Tarefa removida!", "task": removed})


if __name__ == "__main__":
    app.run(debug=True)
