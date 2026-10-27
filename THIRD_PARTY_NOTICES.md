# Third-party notices

The project MIT license applies to original application code, not to a replacement license for third-party distributions.

- Pyodide 0.29.2 is bundled in `public/python` from https://cdn.jsdelivr.net/pyodide/v0.29.2/full/. Its runtime reports 0.29.2; the upstream lock file's `info.version` says `0.28.0.dev0`. That upstream metadata is preserved. The upstream Mozilla Public License 2.0 and included component notices are reproduced in `licenses/PYODIDE-LICENSE.txt`. Source: https://github.com/pyodide/pyodide/tree/0.29.2.
- The bundled standard library is CPython 3.13.2. Its license and historical notices are reproduced in `licenses/PYTHON-LICENSE.txt`. Source: https://github.com/python/cpython/tree/v3.13.2.
- UI components under `components/ui` derive from shadcn/ui, MIT Copyright (c) 2023 shadcn. Notice: `licenses/SHADCN-LICENSE.txt`, source: https://github.com/shadcn-ui/ui.
- Other npm dependencies are installed from the lock file and retain their package license files. They are not vendored as repository source.
