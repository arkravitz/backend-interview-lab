import ast
import contextlib
import inspect
import io
import json
import linecache
import traceback

_MISSING = object()

class LimitedOutput(io.StringIO):
    def write(self, text):
        room = max(0, 20000 - self.tell())
        super().write(text[:room])
        return len(text)

def register_source(filename, source):
    # Test and candidate code is compiled under a synthetic filename that no
    # file lookup resolves, so traceback could only print a bare exception.
    # Publishing the text here makes it quote the failing line.
    linecache.cache[filename] = (
        len(source), None, source.splitlines(True), filename
    )

def assert_failure(exc, expression, left=_MISSING, right=_MISSING):
    # Raises stay in the failing frame, so the traceback keeps pointing at the
    # candidate's own line. The operands ride along on the exception so the
    # values shown are the ones that were actually compared.
    exc.operand_detail = (expression, left, right)
    return exc

def _rewritable(node):
    for child in ast.walk(node):
        if isinstance(
            child, (ast.Await, ast.Yield, ast.YieldFrom, ast.NamedExpr)
        ):
            return False
    return True

def _failure(expression, message, left, right):
    args = [ast.Name(id=left, ctx=ast.Load())]
    if right is not _MISSING:
        args.append(ast.Name(id=right, ctx=ast.Load()))
    call = ast.Call(
        func=ast.Name(id='_lab_detail', ctx=ast.Load()),
        args=[
            ast.Call(
                func=ast.Name(id='AssertionError', ctx=ast.Load()),
                args=[message] if message is not None else [],
                keywords=[],
            ),
            ast.Constant(value=expression),
        ] + args,
        keywords=[],
    )
    return ast.Raise(exc=call, cause=None)

class _AssertRewriter(ast.NodeTransformer):
    # Rewrites `assert a == b` so each side is evaluated exactly once, into a
    # temporary, and compared afterwards. Evaluating the sides up front is what
    # lets a failure report real values: re-running the expression instead
    # would call the candidate's methods a second time and show the wrong
    # answer for anything stateful.
    def visit_Assert(self, node):
        self.generic_visit(node)
        if not _rewritable(node.test):
            return node
        try:
            expression = ast.unparse(node.test)
        except Exception:
            return node
        if isinstance(node.test, ast.Compare) and len(node.test.ops) == 1:
            left_name, right_name = '_lab_left', '_lab_right'
            left_slot, right_slot = ast.Name(id=left_name, ctx=ast.Store()), ast.Name(id=right_name, ctx=ast.Store())
            comparison = ast.Compare(
                left=ast.Name(id=left_name, ctx=ast.Load()),
                ops=node.test.ops,
                comparators=[ast.Name(id=right_name, ctx=ast.Load())],
            )
            branch = ast.If(
                test=ast.UnaryOp(op=ast.Not(), operand=comparison),
                body=[_failure(expression, node.msg, left_name, right_name)],
                orelse=[],
            )
            new = [
                ast.Assign(
                    targets=[left_slot], value=node.test.left
                ),
                ast.Assign(
                    targets=[right_slot], value=node.test.comparators[0]
                ),
                branch,
            ]
        else:
            name = '_lab_value'
            branch = ast.If(
                test=ast.UnaryOp(
                    op=ast.Not(), operand=ast.Name(id=name, ctx=ast.Load())
                ),
                body=[_failure(expression, node.msg, name, _MISSING)],
                orelse=[],
            )
            new = [
                ast.Assign(
                    targets=[ast.Name(id=name, ctx=ast.Store())],
                    value=node.test,
                ),
                branch,
            ]
        for statement in new:
            ast.copy_location(statement, node)
        return new

def compile_source(source, filename):
    tree = _AssertRewriter().visit(ast.parse(source, filename))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)

def short_repr(value, limit=240):
    try:
        text = repr(value)
    except Exception:
        text = '<unrepresentable>'
    return text if len(text) <= limit else text[:limit] + '...'

def assert_expression(line):
    # Fallback for asserts that could not be rewritten: the failing one is the
    # last top-level `assert` on the line, because nothing after it ran.
    depth = 0
    quote = None
    start = None
    i = 0
    while i < len(line):
        ch = line[i]
        if quote is not None:
            if ch == quote:
                quote = None
        elif ch in '"\'':
            quote = ch
        elif ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        elif depth == 0 and line.startswith('assert', i) and (
            i == 0 or not (line[i - 1].isalnum() or line[i - 1] == '_')
        ):
            start = i
            i += len('assert')
            continue
        i += 1
    if start is None:
        return None
    body = line[start + len('assert'):].strip()
    depth = 0
    quote = None
    for i, ch in enumerate(body):
        if quote is not None:
            if ch == quote:
                quote = None
        elif ch in '"\'':
            quote = ch
        elif ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        elif ch == ',' and depth == 0:
            return body[:i].strip()
    return body

def split_comparison(expression):
    depth = 0
    quote = None
    i = 0
    while i < len(expression):
        ch = expression[i]
        if quote is not None:
            if ch == quote:
                quote = None
        elif ch in '"\'':
            quote = ch
        elif ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        elif depth == 0:
            for op in ('==', '!=', '<=', '>=', ' is not ', ' is ', ' in '):
                if expression.startswith(op, i):
                    return expression[:i], op, expression[i + len(op):]
            if ch in '<>' and (i == 0 or expression[i - 1] not in '<>=!'):
                return expression[:i], ch, expression[i + 1:]
        i += 1
    return None

def describe(expression, left, right):
    lines = ['  Failed: ' + expression + '\n']
    if right is _MISSING:
        lines.append('     value = ' + short_repr(left) + '\n')
    else:
        lines.append('     left  = ' + short_repr(left) + '\n')
        lines.append('     right = ' + short_repr(right) + '\n')
    return lines

def fallback_detail(tb):
    frame = tb
    while frame.tb_next:
        frame = frame.tb_next
    filename = frame.tb_frame.f_code.co_filename
    expression = assert_expression(
        linecache.getline(filename, frame.tb_lineno).strip()
    )
    if not expression:
        return []
    scope = (frame.tb_frame.f_globals, frame.tb_frame.f_locals)
    parts = split_comparison(expression)
    if not parts:
        return describe(expression, None, _MISSING)
    left, _, right = parts
    try:
        return describe(
            expression,
            eval(left.strip(), *scope),
            eval(right.strip(), *scope),
        )
    except Exception:
        return describe(expression, None, _MISSING)

def trim_runner_frames(tb):
    # The runner's own frames sit above every real one and only add noise.
    while tb.tb_next and tb.tb_frame.f_code.co_name in (
        'run_submission', 'execute_source'
    ):
        tb = tb.tb_next
    return tb

def format_failure(exc, tb, limit=8):
    parts = traceback.format_exception(
        type(exc), exc, trim_runner_frames(tb), limit=limit
    )
    if isinstance(exc, AssertionError):
        detail = getattr(exc, 'operand_detail', None)
        if detail is None:
            try:
                lines = fallback_detail(tb)
            except Exception:
                lines = []
        else:
            lines = describe(*detail)
        if lines:
            # Keep the exception line last: callers read it to tell a crash
            # from a wrong answer.
            parts = parts[:-1] + lines + parts[-1:]
    return ''.join(parts)

async def execute_source(source, namespace, filename):
    compiled = compile_source(source, filename)
    value = eval(compiled, namespace)
    if inspect.isawaitable(value):
        await value

async def run_submission(payload_json):
    data = json.loads(payload_json)
    output = LimitedOutput()
    results = []
    helpers = {'_lab_detail': assert_failure}
    import sys
    old_stdin = sys.stdin
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            sys.stdin = io.StringIO(data.get('stdin', ''))
            if not data.get('tests'):
                try:
                    register_source('solution.py', data['code'])
                    await execute_source(data['code'], {'__name__':'__main__', **helpers}, 'solution.py')
                except BaseException as exc:
                    return json.dumps({'output':output.getvalue(), 'error':format_failure(exc, exc.__traceback__), 'results':[]})
            else:
                for test in data['tests']:
                    namespace = {'__name__':'__main__', **helpers}
                    filename = 'test: '+test['name']
                    register_source('solution.py', data['code'])
                    register_source(filename, test['code'])
                    try:
                        await execute_source(data['code'], namespace, 'solution.py')
                        await execute_source(test['code'], namespace, filename)
                        results.append({'name':test['name'],'passed':True})
                    except BaseException as exc:
                        results.append({'name':test['name'],'passed':False,'error':format_failure(exc, exc.__traceback__)})
    finally:
        sys.stdin = old_stdin
    text = output.getvalue()
    if len(text) >= 20000:
        text += '\n[Output truncated at 20,000 characters]'
    return json.dumps({'output':text,'results':results})
