from __future__ import annotations

import asyncio
from typing import Awaitable, Iterable, List, TypeVar

T = TypeVar("T")


class ParallelExecutor:
    async def run(self, jobs: Iterable[Awaitable[T]]) -> List[T]:
        tasks = [asyncio.create_task(job) for job in jobs]
        if not tasks:
            return []
        return list(await asyncio.gather(*tasks))
