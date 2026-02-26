import argparse
import csv
import os
from typing import Dict, Optional, Set, Tuple

from supabase import Client, create_client


def get_supabase_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )

    if not supabase_url or not supabase_key:
        raise RuntimeError(
            "缺少 Supabase 環境變數，請設定 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（或 NEXT_PUBLIC_SUPABASE_*）"
        )

    return create_client(supabase_url, supabase_key)


def to_float_or_zero(value: Optional[str]) -> float:
    if value is None:
        return 0.0

    text = str(value).strip()
    if text == "":
        return 0.0

    return float(text)


def normalize_row(row: Dict[str, str]) -> Dict[str, object]:
    code = str(row.get("code", "")).strip()
    if code == "":
        raise ValueError("code 欄位不可為空")

    payload = {
        "code": code,
        "name": str(row.get("name", "")).strip(),
        "price": to_float_or_zero(row.get("price")),
        "cost": to_float_or_zero(row.get("cost")),
        "category": str(row.get("category", "")).strip(),
    }

    return payload


def process_csv(csv_path: str, supabase: Client) -> Tuple[int, int]:
    success_count = 0
    fail_count = 0
    seen_codes: Set[str] = set()

    with open(csv_path, mode="r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)

        required_headers = {"code", "name", "price", "cost", "category"}
        if reader.fieldnames is None:
            raise RuntimeError("CSV 檔案沒有標題列")

        missing_headers = required_headers - set(reader.fieldnames)
        if missing_headers:
            raise RuntimeError(f"CSV 缺少必要欄位: {', '.join(sorted(missing_headers))}")

        for row in reader:
            code = str(row.get("code", "")).strip() or "(空白 code)"

            try:
                payload = normalize_row(row)

                normalized_code = str(payload["code"])
                if normalized_code in seen_codes:
                    raise ValueError("CSV 內發現重複 code，已拒絕覆蓋")
                seen_codes.add(normalized_code)

                supabase.table("products").upsert(payload, on_conflict="code").execute()
                print(f"✅ 已更新商品: {normalized_code}")
                success_count += 1
            except Exception as error:
                print(f"❌ 失敗商品: {code}, 錯誤訊息: {error}")
                fail_count += 1

    return success_count, fail_count


def main() -> None:
    parser = argparse.ArgumentParser(description="批次更新 products 的 name / price / cost / category（以 code 為唯一鍵）")
    parser.add_argument("csv_path", help="CSV 檔案路徑，例如: products_update.csv")
    args = parser.parse_args()

    supabase = get_supabase_client()
    success_count, fail_count = process_csv(args.csv_path, supabase)

    print("=" * 40)
    print(f"成功筆數: {success_count}")
    print(f"失敗筆數: {fail_count}")


if __name__ == "__main__":
    main()