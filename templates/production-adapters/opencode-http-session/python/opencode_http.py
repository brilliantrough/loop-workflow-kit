from __future__ import annotations

import base64
import json
import socket
from dataclasses import dataclass
from urllib import error, request


JSONScalar = str | int | float | bool | None
JSONValue = JSONScalar | list["JSONValue"] | dict[str, "JSONValue"]
JSONMap = dict[str, JSONValue]
JSONArray = list[JSONValue]

JSON_HEADERS = {"Content-Type": "application/json", "Accept": "application/json"}


class OpencodeHttpError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class OpencodeHttpConfig:
    base_url: str
    timeout_sec: float
    username: str | None
    password: str | None


@dataclass(frozen=True, slots=True)
class SessionCreateResult:
    session_id: str
    title: str | None


class OpencodeHttpClient:
    def __init__(self, config: OpencodeHttpConfig) -> None:
        self._config = config

    def health(self) -> JSONMap:
        return self._request_json("GET", "/global/health")

    def get_session(self, session_id: str) -> JSONMap | None:
        try:
            return self._request_json("GET", f"/session/{session_id}")
        except OpencodeHttpError as exc:
            if "HTTP 404" in str(exc):
                return None
            raise

    def create_session(self, title: str) -> SessionCreateResult:
        payload = self._request_json("POST", "/session", body={"title": title})
        session_id = payload.get("id")
        if not isinstance(session_id, str) or not session_id:
            raise OpencodeHttpError("session create response missing string id")
        title_value = payload.get("title")
        return SessionCreateResult(session_id=session_id, title=title_value if isinstance(title_value, str) else None)

    def list_messages(self, session_id: str) -> tuple[JSONMap, ...]:
        payload = self._request_json_array("GET", f"/session/{session_id}/message")
        messages: list[JSONMap] = []
        for index, item in enumerate(payload):
            if not isinstance(item, dict):
                raise OpencodeHttpError(f"expected JSON object at /session/{session_id}/message[{index}]")
            messages.append(item)
        return tuple(messages)

    def send_prompt_async(self, session_id: str, *, agent: str, prompt: str) -> None:
        self._request_void(
            "POST",
            f"/session/{session_id}/prompt_async",
            body={"agent": agent, "parts": [{"type": "text", "text": prompt}]},
        )

    def _request_json(self, method: str, path: str, body: JSONMap | None = None) -> JSONMap:
        payload = self._request_json_value(method, path, body)
        if not isinstance(payload, dict):
            raise OpencodeHttpError(f"expected JSON object for {method} {path}")
        return payload

    def _request_json_array(self, method: str, path: str, body: JSONMap | None = None) -> JSONArray:
        payload = self._request_json_value(method, path, body)
        if not isinstance(payload, list):
            raise OpencodeHttpError(f"expected JSON array for {method} {path}")
        return payload

    def _request_json_value(self, method: str, path: str, body: JSONMap | None = None) -> JSONValue:
        response_text = self._request(method, path, body)
        try:
            return json.loads(response_text)
        except json.JSONDecodeError as exc:
            raise OpencodeHttpError(f"invalid JSON response for {method} {path}") from exc

    def _request_void(self, method: str, path: str, body: JSONMap | None = None) -> None:
        self._request(method, path, body)

    def _request(self, method: str, path: str, body: JSONMap | None) -> str:
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = request.Request(self._config.base_url.rstrip("/") + path, data=data, method=method)
        for key, value in JSON_HEADERS.items():
            req.add_header(key, value)
        auth_header = basic_auth_header(self._config.username, self._config.password)
        if auth_header is not None:
            req.add_header("Authorization", auth_header)
        try:
            with request.urlopen(req, timeout=self._config.timeout_sec) as response:
                return response.read().decode("utf-8")
        except error.HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="replace")
            raise OpencodeHttpError(f"HTTP {exc.code} for {method} {path}: {body_text}") from exc
        except TimeoutError as exc:
            raise OpencodeHttpError(f"timeout for {method} {path}: {exc}") from exc
        except socket.timeout as exc:
            raise OpencodeHttpError(f"timeout for {method} {path}: {exc}") from exc
        except error.URLError as exc:
            raise OpencodeHttpError(f"transport error for {method} {path}: {exc.reason}") from exc


def basic_auth_header(username: str | None, password: str | None) -> str | None:
    if password is None:
        return None
    user = username or "opencode"
    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"
