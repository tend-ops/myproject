"""
在收集用例之前注册占位模块，避免因未安装 chromadb / sentence_transformers 导致契约测试收集失败。
"""
from __future__ import annotations

import sys
import types


def _install_optional_dependency_stubs() -> None:
    if 'chromadb' not in sys.modules:
        chroma_mod = types.ModuleType('chromadb')

        class _PersistentClient:
            def __init__(self, *args, **kwargs) -> None:
                pass

            def get_or_create_collection(self, _name):  # noqa: ANN001
                coll = types.SimpleNamespace()
                coll.add = lambda *a, **k: None
                coll.query = lambda *a, **k: {'documents': [[]], 'distances': [[]]}
                return coll

        chroma_mod.PersistentClient = _PersistentClient
        sys.modules['chromadb'] = chroma_mod

    if 'sentence_transformers' not in sys.modules:
        st_mod = types.ModuleType('sentence_transformers')

        class SentenceTransformer:  # noqa: N801
            def __init__(self, *args, **kwargs) -> None:
                pass

            def encode(self, _text):  # noqa: ANN001
                return [[0.0] * 8]

        st_mod.SentenceTransformer = SentenceTransformer
        sys.modules['sentence_transformers'] = st_mod


_install_optional_dependency_stubs()
