import json
import sys
from pathlib import Path

from main import app


def main() -> None:
    target = Path(sys.argv[1])
    target.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
