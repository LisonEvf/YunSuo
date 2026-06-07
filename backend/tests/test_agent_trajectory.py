import asyncio
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import app.agent.agent as agent_module
from app.agent.agent import SentimentAgent
from app.agent.trajectory import (
    SUCCESS_FILE,
    TrajectoryRecorder,
    export_trajectory_samples,
    load_trajectories,
    summarize_trajectories,
)


class _Obj:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _Message(_Obj):
    def model_dump(self):
        dumped = {"role": "assistant", "content": getattr(self, "content", None)}
        tool_calls = getattr(self, "tool_calls", None)
        if tool_calls:
            dumped["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in tool_calls
            ]
        return dumped


def _tool_call(name: str, arguments: dict):
    return _Obj(
        id="call-1",
        function=_Obj(name=name, arguments=json.dumps(arguments, ensure_ascii=False)),
    )


def _response(*, finish_reason: str, message: _Message):
    return _Obj(
        choices=[_Obj(finish_reason=finish_reason, message=message)],
        usage=_Obj(prompt_tokens=10, completion_tokens=5),
    )


def _run(coro):
    try:
        return asyncio.run(coro)
    finally:
        asyncio.set_event_loop(asyncio.new_event_loop())


def test_trajectory_recorder_writes_sharegpt_jsonl(tmp_path):
    recorder = TrajectoryRecorder(tmp_path)

    path = recorder.record(
        system_prompt="system prompt",
        input_messages=[{"role": "user", "content": "看一下情绪"}],
        tool_events=[
            {
                "name": "get_sentiment_overview",
                "arguments": {},
                "result": '{"kpis": {"sentiment": 60}}',
            }
        ],
        final_content="情绪偏强",
        model="test-model",
        completed=True,
    )

    assert path == tmp_path / SUCCESS_FILE
    record = json.loads(path.read_text(encoding="utf-8").strip())
    assert record["completed"] is True
    assert record["conversations"][0]["from"] == "system"
    assert record["conversations"][1] == {"from": "human", "value": "看一下情绪"}
    assert record["conversations"][-1] == {"from": "gpt", "value": "情绪偏强"}
    assert record["tool_stats"]["get_sentiment_overview"]["success"] == 1


def test_chat_records_tool_trajectory(monkeypatch):
    agent = SentimentAgent(api_key="test", base_url="http://test.invalid/v1", model="test-model")
    calls = {"count": 0}
    records = []

    async def fake_call_llm(api_messages, *, stream=False):
        calls["count"] += 1
        if calls["count"] == 1:
            return _response(
                finish_reason="tool_calls",
                message=_Message(
                    content=None,
                    tool_calls=[_tool_call("get_sentiment_overview", {})],
                ),
            )
        return _response(finish_reason="stop", message=_Message(content="情绪偏强", tool_calls=None))

    async def fake_fetch_snapshot():
        return None

    async def fake_execute_tool(name, args, *, snapshot=None):
        return json.dumps({"overview": {"cycle": "启动"}}, ensure_ascii=False)

    monkeypatch.setattr(agent, "_call_llm", fake_call_llm)
    monkeypatch.setattr(agent, "_fetch_snapshot", fake_fetch_snapshot)
    monkeypatch.setattr(agent_module, "execute_tool", fake_execute_tool)
    monkeypatch.setattr(agent_module.memory_manager, "extract_and_save", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(agent_module.trajectory_recorder, "record", lambda **kwargs: records.append(kwargs))
    monkeypatch.setattr(agent_module, "record_skill_usage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(agent_module.background_review_recorder, "record", lambda **_kwargs: None)

    result = _run(agent.chat([{"role": "user", "content": "分析今天情绪"}]))

    assert result["content"] == "情绪偏强"
    assert len(records) == 1
    assert records[0]["completed"] is True
    assert records[0]["tool_events"][0]["name"] == "get_sentiment_overview"
    assert records[0]["final_content"] == "情绪偏强"
    assert records[0]["metadata"]["selected_skills"][0]["slug"] == "market-analysis"


def test_chat_stream_saves_memory_and_trajectory(monkeypatch):
    agent = SentimentAgent(api_key="test", base_url="http://test.invalid/v1", model="test-model")
    records = []
    saved = []

    async def stream_chunks():
        yield _Obj(choices=[_Obj(delta=_Obj(content="我喜欢低吸", tool_calls=None))])

    async def fake_call_llm(api_messages, *, stream=False):
        return stream_chunks()

    monkeypatch.setattr(agent, "_call_llm", fake_call_llm)
    monkeypatch.setattr(agent_module.memory_manager, "extract_and_save", lambda *args, **_kwargs: saved.append(args))
    monkeypatch.setattr(agent_module.trajectory_recorder, "record", lambda **kwargs: records.append(kwargs))
    monkeypatch.setattr(agent_module, "record_skill_usage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(agent_module.background_review_recorder, "record", lambda **_kwargs: None)

    async def collect():
        return [event async for event in agent.chat_stream([{"role": "user", "content": "我喜欢低吸"}])]

    events = _run(collect())

    assert events[-1] == {"type": "done"}
    assert saved
    assert len(records) == 1
    assert records[0]["completed"] is True
    assert records[0]["stream"] is True
    assert records[0]["final_content"] == "我喜欢低吸"


def test_trajectory_export_and_summary(tmp_path):
    recorder = TrajectoryRecorder(tmp_path)
    recorder.record(
        system_prompt="system",
        input_messages=[{"role": "user", "content": "分析情绪"}],
        tool_events=[{"name": "get_sentiment_overview", "arguments": {}, "result": "{}"}],
        final_content="ok",
        model="test-model",
        completed=True,
        metadata={"selected_skills": [{"slug": "market-analysis", "source": "auto", "score": 4.0}]},
    )
    recorder.record(
        system_prompt="system",
        input_messages=[{"role": "user", "content": "失败样本"}],
        tool_events=[{"name": "get_sentiment_overview", "arguments": {}, "result": "{}", "error": "boom"}],
        final_content="",
        model="test-model",
        completed=False,
        error="boom",
    )

    completed = load_trajectories(base_dir=tmp_path, completed=True)
    assert len(completed) == 1
    assert completed[0]["completed"] is True

    export_path = export_trajectory_samples(tmp_path / "exports" / "samples.jsonl", base_dir=tmp_path)
    exported = export_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(exported) == 1
    exported_record = json.loads(exported[0])
    assert exported_record["conversations"][-1] == {"from": "gpt", "value": "ok"}

    summary = summarize_trajectories(base_dir=tmp_path)
    assert summary["total"] == 2
    assert summary["completed"] == 1
    assert summary["failed"] == 1
    assert summary["tool_calls"] == 2
    assert summary["tool_failures"] == 1
    assert summary["selected_skills"]["market-analysis"] == 1


def test_skill_prompts_do_not_reference_removed_dashboard_tool():
    skill_dir = Path(__file__).resolve().parents[2] / "skills"
    contents = "\n".join(path.read_text(encoding="utf-8") for path in skill_dir.rglob("SKILL.md"))
    removed_tool_name = "get_" + "dashboard"
    assert removed_tool_name not in contents
