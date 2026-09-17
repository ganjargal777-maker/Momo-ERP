import json
import sys
from pathlib import Path

import openpyxl


def number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


source = Path(sys.argv[1])
target = Path(sys.argv[2])
sheet = openpyxl.load_workbook(source, data_only=True, read_only=True).active
products = []

for row in sheet.iter_rows(min_row=2, values_only=True):
    name = str(row[1] or "").strip()
    if not name:
        continue
    products.append({
        "id": str(row[8] or row[2] or row[0]),
        "name": name,
        "sku": str(row[2] or "").strip(),
        "category": str(row[3] or "Ангилалгүй").strip(),
        "department": str(row[4] or "-").strip(),
        "stock": int(number(row[5])),
        "price": number(row[6]),
        "discountPrice": number(row[7]),
        "cost": number(row[10]),
    })

target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(products, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(json.dumps({"products": len(products), "output": str(target)}, ensure_ascii=False))
