import argparse
import json
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = "https://firestore.googleapis.com/v1/projects/patitas-seguras-salta/databases/(default)/documents/chapitas"
PUBLIC = {"name", "phone", "notes", "photo", "updatedAt"}


def request(token, url, method="GET", body=None):
    headers = {"Authorization": "Bearer " + token}
    if body is not None:
        headers["Content-Type"] = "application/json"
    with urlopen(Request(url, data=body, headers=headers, method=method), timeout=45) as response:
        return json.load(response)


def scan(token):
    result = {"fichas": 0, "con_pin": 0, "con_campos_adicionales": 0, "datos_publicos_invalidos": 0}
    pending = []
    query = {"pageSize": 50}
    while True:
        page = request(token, ROOT + "?" + urlencode(query))
        for entry in page.get("documents", []):
            fields = entry.get("fields", {})
            result["fichas"] += 1
            if fields.keys() - PUBLIC - {"pin"}:
                result["con_campos_adicionales"] += 1
            if any("stringValue" not in fields.get(key, {}) for key in ("name", "phone")) or any(
                "stringValue" not in fields[key] for key in PUBLIC & fields.keys()
            ):
                result["datos_publicos_invalidos"] += 1
            if "pin" in fields:
                result["con_pin"] += 1
                pending.append((entry["name"], entry["updateTime"]))
        cursor = page.get("nextPageToken")
        if not cursor:
            return result, pending
        query["pageToken"] = cursor


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    auth = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, timeout=30)
    if auth.returncode or not auth.stdout.strip():
        print("No se pudo autenticar gcloud.", file=sys.stderr)
        return 1

    token = auth.stdout.strip()
    counts, pending = scan(token)
    print(json.dumps(counts), flush=True)
    if counts["con_campos_adicionales"] or counts["datos_publicos_invalidos"]:
        print("Hay fichas que requieren revisión antes de publicar la regla final.")
        return 2
    if not args.apply:
        return 0

    updated = 0
    commit_url = ROOT.rsplit("/", 1)[0] + ":commit"
    for document_name, update_time in pending:
        write = {
            "update": {"name": document_name, "fields": {}},
            "updateMask": {"fieldPaths": ["pin"]},
            "currentDocument": {"updateTime": update_time},
        }
        body = json.dumps({"writes": [write]}).encode("utf-8")
        request(token, commit_url, "POST", body)
        updated += 1

    verified, _ = scan(token)
    print(json.dumps({"actualizadas": updated, "verificacion": verified}), flush=True)
    return int(
        bool(verified["con_pin"] or verified["con_campos_adicionales"] or verified["datos_publicos_invalidos"])
        or counts["fichas"] != verified["fichas"]
    )


if __name__ == "__main__":
    try:
        sys.exit(main())
    except HTTPError as error:
        print(f"Firestore devolvió HTTP {error.code}. Se puede volver a ejecutar la migración.", file=sys.stderr)
    except (URLError, TimeoutError, ValueError, KeyError, subprocess.TimeoutExpired):
        print("No se pudo completar la operación. Se puede volver a ejecutar la migración.", file=sys.stderr)
    sys.exit(1)
