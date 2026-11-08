# PostgreSQL de la aplicación: la imagen oficial con pgvector compilado.
#
# Sobre la MISMA base que se usaba (postgres:16.14-alpine) a propósito. La
# imagen oficial de pgvector es Debian: pasar de alpine (musl) a Debian (glibc)
# sobre el mismo directorio de datos cambia cómo se ordena el texto y deja
# índices de texto corruptos sin avisar. Compilando acá, la base sigue siendo
# exactamente la misma y solo se agrega la extensión.
#
# La versión mayor de PostgreSQL la vigila el deploy (ci-cd.yml) leyendo este
# FROM: un cambio de mayor no arranca sobre los datos de la anterior.
FROM postgres:16.14-alpine

# Fijada: una versión nueva de pgvector se adopta a propósito, no al recompilar.
ARG PGVECTOR_VERSION=0.8.7

# - with_llvm=no: la imagen oficial está compilada con JIT y PGXS querría
#   generar bitcode con clang; la extensión no lo necesita.
# - OPTFLAGS="": sin -march=native, que ataría el binario al CPU donde se compiló.
RUN set -eux; \
    apk add --no-cache --virtual .build-deps build-base git; \
    git clone --branch "v${PGVECTOR_VERSION}" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector; \
    make -C /tmp/pgvector with_llvm=no OPTFLAGS=""; \
    make -C /tmp/pgvector with_llvm=no OPTFLAGS="" install; \
    rm -rf /tmp/pgvector; \
    apk del .build-deps
