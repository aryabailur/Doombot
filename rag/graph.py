"""Issue relationship graph (F15).

Builds a `{nodes, links}` structure from the repository's own indexed
history, for the force-directed graph in the dashboard.

No new ML pipeline: the relationships already exist. Node embeddings come
from the `{repo}-issues` Chroma collection that duplicate detection already
populates, so this is a read over data the triage graph produced.

Three edge signals, per STRETCH_FEATURES.md 15:
  similarity  cosine between issue embeddings (the RAG signal)
  reference   issue #X literally mentions issue #Y in its body
  metadata    shared labels

The output format matches react-force-graph's `{nodes, links}` contract, so
the 2D and 3D components are a one-line swap.
"""

from __future__ import annotations

import ast
import hashlib
import itertools
import math
from collections import defaultdict, deque
from pathlib import PurePosixPath
import re
from typing import Iterable, Mapping

# Thresholds mirror rag/retriever.find_duplicates so the graph and the
# duplicate detector never disagree about what "similar" means.
DUPLICATE_THRESHOLD = 0.85
RELATED_THRESHOLD = 0.65

# Below this, an edge is noise: with 50+ issues, every pair has *some*
# similarity, and drawing all of them produces a hairball that communicates
# nothing. This is the whole reason the graph is readable.
EDGE_FLOOR = RELATED_THRESHOLD

# "#123" but not "#12345678" (a commit-ish number) and not inside a word.
_ISSUE_REF = re.compile(r"(?<![\w#])#(\d{1,6})(?!\d)")

# GraphDev-style semantic code graph support. The upstream project parses
# TypeScript with tree-sitter; Doombot itself is mostly Python with a React
# dashboard, so this implementation uses Python's real stdlib AST plus a
# conservative TypeScript/JavaScript structural parser. It deliberately skips
# ambiguous calls instead of drawing a confident-looking edge that cannot be
# justified. No LLM is involved in graph construction.
_CODE_SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx"}
_TS_SUFFIXES = {".js", ".jsx", ".ts", ".tsx"}
_HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
_GRAPHDEV_ATTRIBUTION = (
    "Semantic-unit graph and depth-two impact overlay adapted from GraphDev "
    "(MIT, Copyright (c) 2026-present GitLab Inc.) for Doombot F15."
)

_TS_IMPORT = re.compile(
    r"(?:import|export)\s+(?P<clause>.+?)\s+from\s+['\"](?P<module>[^'\"]+)['\"]",
    re.MULTILINE,
)
_TS_FUNCTION = re.compile(
    r"(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+"
    r"(?P<name>[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*"
    r"(?::\s*(?:Promise\s*<\s*\{[^{}]*\}\s*>|[^{=]+))?\s*\{",
    re.MULTILINE,
)
_TS_ARROW = re.compile(
    r"(?:export\s+)?(?:default\s+)?(?:const|let)\s+"
    r"(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?"
    r"(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>\s*\{",
    re.MULTILINE,
)
_TS_CLASS = re.compile(
    r"(?:export\s+)?(?:default\s+)?class\s+"
    r"(?P<name>[A-Za-z_$][\w$]*)[^\{]*\{",
    re.MULTILINE,
)
_TS_CALL = re.compile(r"(?<![.\w$])(?P<name>[A-Za-z_$][\w$]*)\s*\(")
_TS_MEMBER_CALL = re.compile(
    r"(?P<object>[A-Za-z_$][\w$]*)\.(?P<name>[A-Za-z_$][\w$]*)\s*\("
)
_TS_JSX = re.compile(r"<(?P<name>[A-Z][A-Za-z0-9_$]*)\b")
_TS_FETCH = re.compile(
    r"fetch\(\s*(?P<quote>['\"`])(?P<url>.+?)(?P=quote)", re.DOTALL
)
_TS_REQUEST = re.compile(
    r"(?<![.\w$])request\(\s*(?P<quote>['\"`])(?P<url>.+?)(?P=quote)",
    re.DOTALL,
)
_TS_HTTP_METHOD_OPTION = re.compile(
    r"\bmethod\s*:\s*['\"](?P<method>GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)['\"]",
    re.IGNORECASE,
)


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors, without pulling in numpy.

    MiniLM emits L2-normalized vectors, so the dot product *is* the cosine.
    The norms are computed anyway because relying on an upstream invariant
    that a model swap could silently break is how a scoring bug gets in.
    """
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return max(0.0, min(1.0, dot / (norm_a * norm_b)))


def _category(metadata: dict, security_numbers: set[int]) -> str:
    """Triage category driving node colour.

    Order matters and mirrors the decider's priority: a security issue that
    is also a duplicate is still a security issue.
    """
    number = metadata.get("number")
    if number in security_numbers:
        return "security"
    if metadata.get("state") == "closed":
        return "resolved"
    labels = str(metadata.get("labels") or "").lower()
    if "duplicate" in labels:
        return "duplicate"
    if "stale" in labels:
        return "stale"
    return "open"


def _references(body: str, own_number: int, known: set[int]) -> set[int]:
    """Issue numbers explicitly mentioned in this issue's text.

    Self-references and numbers that are not issues in this repo are dropped
    -- a stray "#404" in a stack trace should not draw an edge.
    """
    found = {int(match) for match in _ISSUE_REF.findall(body or "")}
    return {number for number in found if number != own_number and number in known}


def build_graph(repo_name: str, security_numbers: set[int] | None = None) -> dict:
    """Compute the issue relationship graph for a repository.

    Args:
        repo_name: "owner/repo".
        security_numbers: issue numbers the security scanner flagged, used
            for node colour. Optional -- the graph is still useful without it.

    Returns:
        {"nodes": [...], "links": [...], "stats": {...}} -- react-force-graph's
        expected shape. Returns empty lists (never raises) when the repo has
        not been indexed, so the UI renders an empty state instead of an error.
    """
    from rag.embedder import get_collection

    security = security_numbers or set()

    try:
        collection = get_collection(repo_name, "issues")
        # Chroma omits embeddings by default; ask for them explicitly.
        raw = collection.get(include=["metadatas", "documents", "embeddings"])
    except Exception:
        return {"nodes": [], "links": [], "stats": _stats([], [])}

    metadatas = raw.get("metadatas") or []
    documents = raw.get("documents") or []
    embeddings = raw.get("embeddings")
    embeddings = list(embeddings) if embeddings is not None else []

    nodes: list[dict] = []
    vectors: dict[int, list[float]] = {}
    bodies: dict[int, str] = {}

    for index, metadata in enumerate(metadatas):
        number = metadata.get("number")
        if number is None:
            continue

        content = documents[index] if index < len(documents) else ""
        title = (content or "").split("\n", 1)[0].strip() or f"Issue #{number}"

        # Engagement drives node size. Chroma metadata is scalar-only, so
        # these may be absent on issues indexed before the field existed.
        engagement = int(metadata.get("reactions") or 0) + int(
            metadata.get("comments") or 0
        )

        nodes.append({
            "id": f"issue-{number}",
            "number": number,
            "title": title,
            "category": _category(metadata, security),
            "state": metadata.get("state", "open"),
            "labels": [
                label
                for label in str(metadata.get("labels") or "").split(",")
                if label
            ],
            "engagement": engagement,
            "escalated": number in security,
        })

        if index < len(embeddings):
            vectors[number] = list(embeddings[index])
        bodies[number] = content

    known = {node["number"] for node in nodes}
    links: list[dict] = []
    seen: set[tuple[int, int]] = set()

    # --- similarity edges ---------------------------------------------------
    for left, right in itertools.combinations(sorted(vectors), 2):
        score = _cosine(vectors[left], vectors[right])
        if score < EDGE_FLOOR:
            continue
        seen.add((left, right))
        links.append({
            "source": f"issue-{left}",
            "target": f"issue-{right}",
            "kind": "duplicate" if score > DUPLICATE_THRESHOLD else "similar",
            "score": round(score, 3),
            # Rendered verbatim when a maintainer clicks the edge. An edge a
            # human cannot interrogate is decoration, not evidence.
            "why": f"{round(score, 2)} cosine similarity",
        })

    # --- reference edges ----------------------------------------------------
    for number, body in bodies.items():
        for target in _references(body, number, known):
            pair = tuple(sorted((number, target)))
            if pair in seen:
                # A reference is stronger evidence than a similarity score, so
                # it upgrades the existing edge rather than stacking a second
                # line between the same two nodes.
                for link in links:
                    if {link["source"], link["target"]} == {
                        f"issue-{pair[0]}",
                        f"issue-{pair[1]}",
                    }:
                        link["kind"] = "reference"
                        link["why"] += f", and #{number} references #{target}"
                        break
                continue
            seen.add(pair)
            links.append({
                "source": f"issue-{number}",
                "target": f"issue-{target}",
                "kind": "reference",
                "score": 1.0,
                "why": f"#{number} references #{target}",
            })

    # --- shared-label edges -------------------------------------------------
    by_label: dict[str, list[int]] = {}
    for node in nodes:
        for label in node["labels"]:
            by_label.setdefault(label, []).append(node["number"])

    for label, numbers in by_label.items():
        # A label shared by most of the repo (like "bug") connects everything
        # to everything and destroys the clustering the graph exists to show.
        if len(numbers) < 2 or len(numbers) > max(2, len(nodes) // 3):
            continue
        for left, right in itertools.combinations(sorted(numbers), 2):
            pair = (left, right)
            if pair in seen:
                continue
            seen.add(pair)
            links.append({
                "source": f"issue-{left}",
                "target": f"issue-{right}",
                "kind": "metadata",
                "score": 0.5,
                "why": f"shared label: {label}",
            })

    return {"nodes": nodes, "links": links, "stats": _stats(nodes, links)}


def _stats(nodes: list[dict], links: list[dict]) -> dict:
    """Counts the UI shows without walking the whole graph itself."""
    return {
        "node_count": len(nodes),
        "link_count": len(links),
        "duplicate_links": sum(1 for link in links if link["kind"] == "duplicate"),
        "by_category": {
            category: sum(1 for node in nodes if node["category"] == category)
            for category in ("security", "duplicate", "stale", "resolved", "open")
        },
    }


# ---------------------------------------------------------------------------
# Semantic repository graph and blast-radius overlay (GraphDev-tailored F15)
# ---------------------------------------------------------------------------


def _stable_id(value: str) -> str:
    """Return a short, deterministic DOM/API-safe id for a code unit."""
    return "code-" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def _line_number(source: str, offset: int) -> int:
    return source.count("\n", 0, offset) + 1


def _cluster_for_path(file_path: str) -> str:
    """Derive a stable architectural subsystem from a repository path."""
    parts = PurePosixPath(file_path).parts
    if not parts:
        return "root"
    if parts[0] == "dashboard" and len(parts) >= 3 and parts[1] == "src":
        section = parts[2] if len(parts) > 3 else "root"
        return f"dashboard/{section}"
    if parts[0] in {"agents", "api", "rag", "memory", "mcp_server"}:
        if len(parts) > 2 and parts[1] not in {"__pycache__"}:
            return f"{parts[0]}/{parts[1]}" if parts[1] != "src" else parts[0]
        return parts[0]
    return parts[0] if len(parts) > 1 else "root"


def _runtime_for_path(file_path: str) -> str:
    parts = set(PurePosixPath(file_path).parts)
    if "dashboard" in parts or file_path.endswith((".tsx", ".jsx")):
        return "browser"
    if "api" in parts or "mcp_server" in parts:
        return "server"
    return "python" if file_path.endswith(".py") else "shared"


def _python_kind(file_path: str, name: str, parent: str | None, node: ast.AST) -> str:
    decorators = [
        ast.unparse(item) if hasattr(ast, "unparse") else ""
        for item in getattr(node, "decorator_list", [])
    ]
    if any(re.search(r"\.(get|post|put|patch|delete)\(", item) for item in decorators):
        return "api_handler"
    if name.endswith("_node") or any("chain_step" in item for item in decorators):
        return "graph_node"
    if parent:
        return "method"
    return "function"


def _python_route(node: ast.AST) -> tuple[str, str] | None:
    for decorator in getattr(node, "decorator_list", []):
        if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
            continue
        method = decorator.func.attr.upper()
        if method not in _HTTP_METHODS or not decorator.args:
            continue
        path = decorator.args[0]
        if isinstance(path, ast.Constant) and isinstance(path.value, str):
            return method, path.value
    return None


class _PythonUnitVisitor(ast.NodeVisitor):
    """Collect top-level functions, classes, and class methods with calls."""

    def __init__(self, file_path: str, source: str) -> None:
        self.file_path = file_path
        self.source = source
        self.parent_class: str | None = None
        self.function_depth = 0
        self.units: list[dict] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        if self.function_depth:
            return
        self._add_unit(node, node.name, "class", None)
        previous = self.parent_class
        self.parent_class = node.name
        for child in node.body:
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.visit(child)
        self.parent_class = previous

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        if self.function_depth:
            return
        self.function_depth += 1
        self._add_unit(
            node,
            node.name,
            _python_kind(self.file_path, node.name, self.parent_class, node),
            self.parent_class,
        )
        self.function_depth -= 1

    def _add_unit(
        self, node: ast.AST, name: str, kind: str, parent: str | None
    ) -> None:
        symbol = f"{parent}.{name}" if parent else name
        qualname = f"{self.file_path}::{symbol}"
        calls: list[tuple[str, str]] = []
        for child in ast.walk(node):
            if not isinstance(child, ast.Call):
                continue
            if isinstance(child.func, ast.Name):
                calls.append(("calls", child.func.id))
            elif isinstance(child.func, ast.Attribute):
                try:
                    calls.append(("calls", ast.unparse(child.func)))
                except Exception:
                    calls.append(("calls", child.func.attr))
        self.units.append(
            {
                "id": _stable_id(qualname),
                "qualname": qualname,
                "symbol_name": symbol,
                "lookup_name": name,
                "file_path": self.file_path,
                "kind": kind,
                "runtime": _runtime_for_path(self.file_path),
                "language": "python",
                "start_line": getattr(node, "lineno", 1),
                "end_line": getattr(node, "end_lineno", getattr(node, "lineno", 1)),
                "cluster_label": _cluster_for_path(self.file_path),
                "calls": calls,
                "route": _python_route(node),
            }
        )


def _parse_python(file_path: str, source: str) -> list[dict]:
    try:
        tree = ast.parse(source, filename=file_path)
    except (SyntaxError, ValueError):
        return []
    visitor = _PythonUnitVisitor(file_path, source)
    visitor.visit(tree)
    return visitor.units


def _find_matching_brace(source: str, open_offset: int) -> int:
    """Find a JS/TS block end while ignoring strings and comments."""
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    index = open_offset
    while index < len(source):
        char = source[index]
        nxt = source[index + 1] if index + 1 < len(source) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
        elif block_comment:
            if char == "*" and nxt == "/":
                block_comment = False
                index += 1
        elif quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        elif char == "/" and nxt == "/":
            line_comment = True
            index += 1
        elif char == "/" and nxt == "*":
            block_comment = True
            index += 1
        elif char in {"'", '"', "`"}:
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return len(source) - 1


def _typescript_imports(source: str) -> dict[str, tuple[str, str]]:
    imports: dict[str, tuple[str, str]] = {}
    for match in _TS_IMPORT.finditer(source):
        clause = match.group("clause").strip()
        module = match.group("module")
        if clause.startswith("{"):
            for item in clause.strip("{} ").split(","):
                bits = [bit.strip() for bit in item.split(" as ")]
                if bits and bits[0]:
                    imports[bits[-1]] = (module, bits[0])
        elif clause.startswith("* as "):
            imports[clause[5:].strip()] = (module, "*")
        else:
            default_name = clause.split(",", 1)[0].strip()
            if default_name:
                imports[default_name] = (module, "default")
    return imports


def _typescript_kind(file_path: str, name: str, body: str, declared: str) -> str:
    if declared == "class":
        return "class"
    if PurePosixPath(file_path).name in {"route.ts", "route.tsx"} and name.upper() in _HTTP_METHODS:
        return "api_handler"
    if len(name) > 3 and name.startswith("use") and name[3].isupper():
        return "hook"
    if name[:1].isupper() and ("return (" in body or "<" in body):
        return "component"
    return "function"


def _typescript_http_target(body: str, match: re.Match[str]) -> str:
    """Preserve an explicit request method so GET/POST route pairs do not collide."""
    option_window = body[match.end() : match.end() + 240]
    method = _TS_HTTP_METHOD_OPTION.search(option_window)
    verb = method.group("method").upper() if method else "GET"
    return f"{verb} {match.group('url')}"


def _parse_typescript(file_path: str, source: str) -> list[dict]:
    units: list[dict] = []
    declarations: list[tuple[re.Pattern[str], str]] = [
        (_TS_FUNCTION, "function"),
        (_TS_ARROW, "function"),
        (_TS_CLASS, "class"),
    ]
    for pattern, declared in declarations:
        for match in pattern.finditer(source):
            name = match.group("name")
            # Every declaration pattern ends on the body brace. Using the
            # first brace in the full match mistakes object-shaped return
            # types such as Promise<{ ok: boolean }> for the function body.
            open_offset = match.end() - 1
            if open_offset < 0:
                continue
            end_offset = _find_matching_brace(source, open_offset)
            body = source[open_offset : end_offset + 1]
            calls = [("calls", item.group("name")) for item in _TS_CALL.finditer(body)]
            calls.extend(
                ("calls", f"{item.group('object')}.{item.group('name')}")
                for item in _TS_MEMBER_CALL.finditer(body)
            )
            calls.extend(("renders", item.group("name")) for item in _TS_JSX.finditer(body))
            for fetch in _TS_FETCH.finditer(body):
                calls.append(("http_calls", _typescript_http_target(body, fetch)))
            # Doombot's dashboard deliberately funnels fetch through the
            # typed request() helper. Treat literal/template route arguments
            # exactly like fetch() so browser-to-FastAPI dependencies are not
            # lost merely because transport is centralized in lib/api.ts.
            for request in _TS_REQUEST.finditer(body):
                calls.append(("http_calls", _typescript_http_target(body, request)))
            qualname = f"{file_path}::{name}"
            units.append(
                {
                    "id": _stable_id(qualname),
                    "qualname": qualname,
                    "symbol_name": name,
                    "lookup_name": name,
                    "file_path": file_path,
                    "kind": _typescript_kind(file_path, name, body, declared),
                    "runtime": _runtime_for_path(file_path),
                    "language": "typescript" if file_path.endswith((".ts", ".tsx")) else "javascript",
                    "start_line": _line_number(source, match.start()),
                    "end_line": _line_number(source, end_offset),
                    "cluster_label": _cluster_for_path(file_path),
                    "calls": calls,
                    "imports": _typescript_imports(source),
                    "route": None,
                }
            )
    # A declaration may match two patterns after syntax recovery. Keep the
    # first occurrence for a stable qualname rather than duplicating nodes.
    return list({unit["qualname"]: unit for unit in units}.values())


def _resolve_ts_file(importer: str, module: str, known_paths: set[str]) -> str | None:
    if module.startswith("@/"):
        base = "dashboard/src/" + module[2:] if importer.startswith("dashboard/") else "src/" + module[2:]
    elif module.startswith("."):
        base = str(PurePosixPath(importer).parent.joinpath(module))
    else:
        return None
    parts: list[str] = []
    for part in PurePosixPath(base).parts:
        if part == "..":
            if parts:
                parts.pop()
        elif part not in {".", ""}:
            parts.append(part)
    normalized = "/".join(parts)
    candidates = [normalized]
    candidates.extend(normalized + suffix for suffix in _TS_SUFFIXES)
    candidates.extend(normalized + "/index" + suffix for suffix in _TS_SUFFIXES)
    return next((candidate for candidate in candidates if candidate in known_paths), None)


def _normalise_route(path: str) -> str:
    # Doombot appends a prebuilt query string to several typed API routes.
    # It is transport metadata, not part of the FastAPI path template.
    path = re.sub(
        r"\$\{(?:query|encoded|params|searchParams)\}$",
        "",
        path,
        flags=re.IGNORECASE,
    )
    path = re.sub(r"\$\{[^}]+\}|\{[^}]+\}|\[[^]]+\]", "{}", path)
    return re.sub(r"/+", "/", path.split("?", 1)[0]).rstrip("/") or "/"


def _select_target(
    source: dict,
    raw_name: str,
    edge_type: str,
    by_symbol: Mapping[str, list[dict]],
    by_file_symbol: Mapping[tuple[str, str], dict],
    known_paths: set[str],
    routes: Mapping[str, dict],
) -> dict | None:
    if edge_type == "http_calls":
        method, separator, route_path = raw_name.partition(" ")
        if separator and method in _HTTP_METHODS:
            exact = routes.get(f"{method} {_normalise_route(route_path)}")
            if exact:
                return exact
        return routes.get(_normalise_route(route_path if separator else raw_name))

    name = raw_name.rsplit(".", 1)[-1]
    same_file = by_file_symbol.get((source["file_path"], name))
    if same_file and same_file["id"] != source["id"]:
        return same_file

    imports = source.get("imports") or {}
    root_name = raw_name.split(".", 1)[0]
    imported = imports.get(root_name)
    if imported:
        module, original = imported
        resolved_file = _resolve_ts_file(source["file_path"], module, known_paths)
        target_name = name if original == "*" else (name if original == "default" else original)
        if resolved_file:
            target = by_file_symbol.get((resolved_file, target_name))
            if target:
                return target

    candidates = [item for item in by_symbol.get(name, []) if item["id"] != source["id"]]
    return candidates[0] if len(candidates) == 1 else None


def _layout_code_nodes(nodes: list[dict]) -> None:
    """Assign deterministic 2D/3D cluster coordinates without a new ML stack."""
    grouped: dict[str, list[dict]] = defaultdict(list)
    for node in nodes:
        grouped[node["cluster_label"]].append(node)
    clusters = sorted(grouped)
    for cluster_index, cluster in enumerate(clusters):
        angle = (2 * math.pi * cluster_index) / max(1, len(clusters))
        centre_x = math.cos(angle) * 12
        centre_y = math.sin(angle) * 12
        centre_z = ((cluster_index % 3) - 1) * 4
        members = sorted(grouped[cluster], key=lambda item: item["qualname"])
        for member_index, node in enumerate(members):
            local_angle = member_index * 2.399963229728653
            radius = 1.2 + math.sqrt(member_index) * 1.1
            node["x2d"] = round(centre_x + math.cos(local_angle) * radius, 4)
            node["y2d"] = round(centre_y + math.sin(local_angle) * radius, 4)
            node["x3d"] = node["x2d"]
            node["y3d"] = node["y2d"]
            node["z3d"] = round(centre_z + math.sin(local_angle * 0.7) * radius, 4)


def _impact_overlay(nodes: list[dict], links: list[dict], changed_paths: set[str]) -> dict:
    by_id = {node["id"]: node for node in nodes}
    changed = {
        node["id"]
        for node in nodes
        if node["file_path"] in changed_paths
        or any(node["file_path"].startswith(path.rstrip("/") + "/") for path in changed_paths)
    }
    adjacency: dict[str, set[str]] = defaultdict(set)
    edge_kind: dict[frozenset[str], str] = {}
    for link in links:
        adjacency[link["source"]].add(link["target"])
        adjacency[link["target"]].add(link["source"])
        edge_kind[frozenset((link["source"], link["target"]))] = link["edge_type"]

    # GraphDev skips hubs so one shared utility does not make the whole repo
    # look affected. On very small repositories every connection can exceed
    # 0.15, so enable hub suppression only once the graph is large enough for
    # that score to mean "global connector" rather than "one of four nodes".
    hub_ids = (
        {node["id"] for node in nodes if node["hub_score"] > 0.15}
        if len(nodes) >= 20
        else set()
    )
    distance: dict[str, int] = {node_id: 0 for node_id in changed}
    reached_by: dict[str, str] = {}
    frontier = deque(changed)
    while frontier:
        current = frontier.popleft()
        if distance[current] >= 2:
            continue
        for neighbor in adjacency.get(current, set()):
            if neighbor in hub_ids or neighbor in distance:
                continue
            distance[neighbor] = distance[current] + 1
            reached_by[neighbor] = edge_kind.get(frozenset((current, neighbor)), "calls")
            frontier.append(neighbor)

    for node in nodes:
        if node["id"] in changed:
            node["impact_status"] = "changed"
            node["impact_distance"] = 0
        elif node["id"] in distance:
            node["impact_status"] = "ripple"
            node["impact_distance"] = distance[node["id"]]
        else:
            node["impact_status"] = "unaffected"
            node["impact_distance"] = None

    cluster_counts: dict[str, dict[str, int]] = defaultdict(
        lambda: {"changed": 0, "ripple": 0, "total": 0}
    )
    for node in nodes:
        counts = cluster_counts[node["cluster_label"]]
        counts["total"] += 1
        if node["id"] in changed:
            counts["changed"] += 1
        elif node["id"] in distance:
            counts["ripple"] += 1

    cluster_impact = []
    for cluster, counts in cluster_counts.items():
        if counts["changed"] == 0 and counts["ripple"] == 0:
            continue
        score = (counts["changed"] + counts["ripple"] * 0.5) / max(1, counts["total"])
        cluster_impact.append(
            {
                "cluster": cluster,
                "impact_score": round(min(1.0, score), 2),
                "changed_count": counts["changed"],
                "ripple_count": counts["ripple"],
                "total_count": counts["total"],
            }
        )
    cluster_impact.sort(key=lambda item: item["impact_score"], reverse=True)
    max_score = cluster_impact[0]["impact_score"] if cluster_impact else 0.0
    if len(cluster_impact) > 3 or max_score > 0.8:
        risk_level = "critical"
    elif len(cluster_impact) >= 2 or max_score > 0.5:
        risk_level = "high"
    elif max_score > 0.2:
        risk_level = "medium"
    else:
        risk_level = "low"

    return {
        "risk_level": risk_level,
        "changed_units": [by_id[node_id]["qualname"] for node_id in sorted(changed)],
        "impacted_units": [
            {
                "qualname": by_id[node_id]["qualname"],
                "distance": distance[node_id],
                "edge_type": reached_by.get(node_id, "calls"),
            }
            for node_id in sorted(distance)
            if node_id not in changed
        ],
        "cluster_impact": cluster_impact,
        "suggested_labels": [
            f"{risk_level}-impact",
            *[item["cluster"] for item in cluster_impact],
            *(["cross-subsystem"] if len(cluster_impact) > 1 else []),
        ],
    }


def _fetch_code_files(repo_name: str) -> dict[str, str]:
    from mcp_server.github_client import get_file_content, get_repo_files

    result: dict[str, str] = {}
    for path in get_repo_files(repo_name):
        if PurePosixPath(path).suffix.lower() not in _CODE_SUFFIXES:
            continue
        try:
            result[path] = get_file_content(repo_name, path)
        except Exception:
            # One unreadable/generated file must not erase the useful graph.
            continue
    return result


def build_code_graph(
    repo_name: str,
    changed_paths: Iterable[str] | None = None,
    *,
    files: Mapping[str, str] | None = None,
) -> dict:
    """Build GraphDev-style semantic structure and a blast-radius overlay.

    `files` is an injectable source map used by deterministic verification and
    offline demos. Production callers omit it and repository contents are read
    through Doombot's existing GitHub client. Unsupported or invalid files are
    skipped; an unavailable repository returns an empty graph with an error-safe
    stats object instead of leaking an exception to the dashboard.
    """
    try:
        source_files = dict(files) if files is not None else _fetch_code_files(repo_name)
    except Exception:
        source_files = {}

    supported = {
        path.replace("\\", "/"): content
        for path, content in source_files.items()
        if PurePosixPath(path).suffix.lower() in _CODE_SUFFIXES
    }
    units: list[dict] = []
    for path, source in sorted(supported.items()):
        if path.endswith(".py"):
            units.extend(_parse_python(path, source))
        else:
            units.extend(_parse_typescript(path, source))

    by_symbol: dict[str, list[dict]] = defaultdict(list)
    by_file_symbol: dict[tuple[str, str], dict] = {}
    routes: dict[str, dict] = {}
    for unit in units:
        by_symbol[unit["lookup_name"]].append(unit)
        by_file_symbol[(unit["file_path"], unit["lookup_name"])] = unit
        if unit.get("route"):
            method, route_path = unit["route"]
            normalized = _normalise_route(route_path)
            routes[f"{method} {normalized}"] = unit
            routes.setdefault(normalized, unit)

    links: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    known_paths = set(supported)
    for source in units:
        for edge_type, raw_name in source.pop("calls", []):
            target = _select_target(
                source,
                raw_name,
                edge_type,
                by_symbol,
                by_file_symbol,
                known_paths,
                routes,
            )
            if target is None or target["id"] == source["id"]:
                continue
            key = (source["id"], target["id"], edge_type)
            if key in seen:
                continue
            seen.add(key)
            links.append(
                {
                    "source": source["id"],
                    "target": target["id"],
                    "edge_type": edge_type,
                    "why": f"{source['symbol_name']} {edge_type.replace('_', ' ')} {target['symbol_name']}",
                }
            )

    degrees: dict[str, list[int]] = {unit["id"]: [0, 0] for unit in units}
    for link in links:
        degrees[link["source"]][1] += 1
        degrees[link["target"]][0] += 1
    denominator = max(1, len(units) - 1)
    for unit in units:
        incoming, outgoing = degrees[unit["id"]]
        unit["in_degree"] = incoming
        unit["out_degree"] = outgoing
        unit["hub_score"] = round((incoming + outgoing) / denominator, 4)
        unit.pop("lookup_name", None)
        unit.pop("imports", None)
        unit.pop("route", None)

    _layout_code_nodes(units)
    changed = {path.replace("\\", "/") for path in changed_paths or [] if path}
    impact = _impact_overlay(units, links, changed)
    clusters = sorted({unit["cluster_label"] for unit in units})
    return {
        "repository": repo_name,
        "nodes": units,
        "links": links,
        "stats": {
            "node_count": len(units),
            "link_count": len(links),
            "cluster_count": len(clusters),
            "clusters": clusters,
            "languages": sorted({unit["language"] for unit in units}),
            "attribution": _GRAPHDEV_ATTRIBUTION,
        },
        "impact": impact,
    }
