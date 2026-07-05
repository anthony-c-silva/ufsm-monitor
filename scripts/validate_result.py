#!/usr/bin/env python3
"""Valida um envelope de resultado contra contracts/result.schema.json.

Uso:
    ./bin/icmp -target 1.1.1.1 | python3 scripts/validate_result.py
    python3 scripts/validate_result.py contracts/examples/icmp.result.json

Se a lib `jsonschema` estiver instalada, faz validacao completa do schema.
Caso contrario, cai para uma checagem minima (campos obrigatorios + enums),
suficiente para o dia a dia da Fase 1.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "contracts" / "result.schema.json"

REQUIRED = [
    "schema_version", "run_id", "probe_id", "kind",
    "observed_at", "started_at", "finished_at", "status", "result",
]
KINDS = {"icmp", "iperf3", "dns", "http", "traceroute", "sysinfo"}
STATUSES = {"success", "failure", "timeout"}


def load_input():
    if len(sys.argv) > 1:
        return json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    return json.loads(sys.stdin.read())


def minimal_check(doc):
    errors = []
    for key in REQUIRED:
        if key not in doc:
            errors.append(f"campo obrigatorio ausente: {key}")
    if doc.get("kind") not in KINDS:
        errors.append(f"kind invalido: {doc.get('kind')!r}")
    if doc.get("status") not in STATUSES:
        errors.append(f"status invalido: {doc.get('status')!r}")
    return errors


def main():
    try:
        doc = load_input()
    except json.JSONDecodeError as e:
        print(f"FALHOU: JSON invalido: {e}")
        sys.exit(1)

    try:
        import jsonschema  # type: ignore
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        jsonschema.validate(doc, schema)
        print(f"OK (jsonschema): kind={doc.get('kind')} status={doc.get('status')}")
    except ImportError:
        errors = minimal_check(doc)
        if errors:
            print("FALHOU (checagem minima):")
            for e in errors:
                print("  -", e)
            sys.exit(1)
        print(f"OK (checagem minima): kind={doc.get('kind')} status={doc.get('status')}")
    except Exception as e:  # jsonschema.ValidationError etc.
        print(f"FALHOU: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
