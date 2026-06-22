# rxshield-web/scripts/query_db_bridge.py
import sqlite3
import sys
import json

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing arguments. Need db_path and sql"}))
        return
    
    db_path = sys.argv[1]
    sql = sys.argv[2]
    
    # Parse positional arguments, converting to int/float where possible
    params = []
    for arg in sys.argv[3:]:
        try:
            params.append(int(arg))
        except ValueError:
            try:
                params.append(float(arg))
            except ValueError:
                params.append(arg)
    
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = [dict(row) for row in cur.fetchall()]
        print(json.dumps(rows))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == '__main__':
    main()
