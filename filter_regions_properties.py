#!/usr/bin/env python3

"""Filter TopoJSON/JSON region properties to a reduced field set.

The script preserves the original structure and values everywhere except for
any object named ``properties``, which is reduced to a fixed allowlist of keys.
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from pathlib import Path
from typing import Any


ALLOWED_PROPERTY_KEYS = (
    "featurecla",
    "adm1_code",
    "name",
    "type_en",
    "woe_label",
    "latitude",
    "longitude",
    "admin",
)


def filter_properties(value: Any) -> Any:
    if isinstance(value, dict):
        filtered = {}
        for key, item in value.items():
            if key == "properties" and isinstance(item, dict):
                filtered[key] = {
                    allowed_key: item[allowed_key]
                    for allowed_key in ALLOWED_PROPERTY_KEYS
                    if allowed_key in item
                }
            else:
                filtered[key] = filter_properties(item)
        return filtered
    if isinstance(value, list):
        return [filter_properties(item) for item in value]
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read a region TopoJSON/JSON file and write a copy with filtered "
            "properties fields."
        )
    )
    parser.add_argument("input_file", type=Path, help="Path to the source JSON file")
    parser.add_argument(
        "output_file",
        type=Path,
        nargs="?",
        help=(
            "Path to the filtered output file; if omitted, the input file is "
            "backed up and overwritten in place"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_file = args.output_file or args.input_file

    with args.input_file.open("r", encoding="utf-8") as source:
        data = json.load(source)

    filtered_data = filter_properties(data)

    if output_file == args.input_file:
        backup_file = args.input_file.with_name(
            f"{args.input_file.name}.bak"
        )
        shutil.copy2(args.input_file, backup_file)

        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=args.input_file.parent, delete=False
        ) as temporary_file:
            json.dump(filtered_data, temporary_file, ensure_ascii=False, indent=2)
            temporary_file.write("\n")
            temporary_path = Path(temporary_file.name)

        temporary_path.replace(args.input_file)
    else:
        with output_file.open("w", encoding="utf-8") as destination:
            json.dump(filtered_data, destination, ensure_ascii=False, indent=2)
            destination.write("\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())