#!/bin/sh
set -eu

# MySQL runs this only when initializing the local data volume for the first time.
# Keep migration scratch space separate from the application database.
case "$MYSQL_SHADOW_DATABASE" in
  ''|*[!a-zA-Z0-9_]*)
    echo 'MYSQL_SHADOW_DATABASE must contain only letters, numbers and underscores' >&2
    exit 1
    ;;
esac
case "$MYSQL_USER" in
  ''|*[!a-zA-Z0-9_-]*)
    echo 'MYSQL_USER must contain only letters, numbers, underscores and hyphens' >&2
    exit 1
    ;;
esac
if [ "$MYSQL_SHADOW_DATABASE" = "$MYSQL_DATABASE" ]; then
  echo 'The shadow database must differ from the application database' >&2
  exit 1
fi

MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket --user=root <<SQL
CREATE DATABASE IF NOT EXISTS \`$MYSQL_SHADOW_DATABASE\`;
GRANT ALL PRIVILEGES ON \`$MYSQL_SHADOW_DATABASE\`.* TO '$MYSQL_USER'@'%';
SQL
