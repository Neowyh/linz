"""CLI 传输测试工具：从 stdin 读 JSON，回显到 stdout。

用法（模拟 Agent 调用）:
    echo {"model": "wing", "mesh": 0.5} | python echo_tool.py
"""
import json
import sys


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"error": "stdin 为空"}, ensure_ascii=False))
        return
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"JSON 解析失败: {e}", "raw": raw[:200]}, ensure_ascii=False))
        return
    print(
        json.dumps(
            {"echo": data, "keys": sorted(data.keys()) if isinstance(data, dict) else None},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
