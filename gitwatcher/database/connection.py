from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from ..config import settings

pool = ConnectionPool(
    conninfo=settings.database_url,
    kwargs={"autocommit": True, "row_factory": dict_row},
    min_size=1,
    max_size=5,
    open=False,
)

def open_pool() -> None:
    if pool.closed:
        pool.open(wait=True)

def close_pool() -> None:
    if not pool.closed:
        pool.close()
