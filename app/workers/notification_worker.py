from __future__ import annotations

import argparse
import time

from app.services.notification_service import notification_service
from app.utils.helpers import logger


def run_once(limit: int = 20) -> dict[str, int]:
    result = notification_service.process_pending_notifications(limit=limit)
    logger.info("Notification worker processed queue: %s", result)
    return result


def run_forever(limit: int = 20, interval_seconds: int = 30) -> None:
    logger.info("Notification worker started with interval=%ss limit=%s", interval_seconds, limit)
    while True:
        run_once(limit=limit)
        time.sleep(interval_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Notification queue worker")
    parser.add_argument("--once", action="store_true", help="Process the queue once and exit.")
    parser.add_argument("--limit", type=int, default=20, help="Max pending items per run.")
    parser.add_argument("--interval", type=int, default=30, help="Polling interval in seconds for loop mode.")
    args = parser.parse_args()

    if args.once:
        run_once(limit=args.limit)
        return
    run_forever(limit=args.limit, interval_seconds=args.interval)


if __name__ == "__main__":
    main()
