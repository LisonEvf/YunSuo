"""结构化意图（Intent）单元测试 —— 生成式 UI 点击即对话。"""
from app.agent.intent import (
    Intent,
    encode_intent_envelope,
    parse_intent_envelope,
    extract_intents_from_messages,
)
from app.agent.intent import (
    PredictionMissRecorder,
    build_prediction_miss_context_block,
    record_prediction_miss_if_any,
)


def test_encode_decode_roundtrip_preserves_full_intent():
    intent = {
        "action": "drilldown",
        "target": "artifact-sales",
        "label": "查看华东区明细",
        "params": {"region": "华东", "index": 2},
        "source": "Table.click",
        "prompt": "展开华东区销售明细",
    }
    envelope = encode_intent_envelope(intent)
    assert envelope.startswith("<<yunsuo-intent:") and envelope.endswith(">>")
    parsed, remaining = parse_intent_envelope(f"prefix {envelope} suffix")
    assert parsed.action == "drilldown"
    assert parsed.target == "artifact-sales"
    assert parsed.label == "查看华东区明细"
    assert parsed.params == {"region": "华东", "index": 2}
    assert parsed.source == "Table.click"
    assert parsed.prompt == "展开华东区销售明细"
    assert remaining == "prefix  suffix"


def test_parse_without_envelope_returns_empty_intent_and_original():
    parsed, remaining = parse_intent_envelope("just a normal user message")
    assert parsed.is_empty()
    assert remaining == "just a normal user message"


def test_parse_handles_malformed_envelope_gracefully():
    parsed, remaining = parse_intent_envelope("<<yunsuo-intent:not-json>>")
    assert parsed.is_empty()
    # 损坏的信封原样保留，不丢消息
    assert "not-json" in remaining


def test_parse_accepts_predicted_label_alias():
    envelope = encode_intent_envelope({"action": "open", "predicted_label": "打开报表"})
    parsed, _ = parse_intent_envelope(envelope)
    assert parsed.label == "打开报表"


def test_extract_intents_picks_latest_user_intent_and_cleans_messages():
    first_env = encode_intent_envelope({"action": "open", "target": "a1"})
    last_env = encode_intent_envelope({"action": "drilldown", "target": "a2", "label": "深入"})
    messages = [
        {"role": "user", "content": f"{first_env} first"},
        {"role": "assistant", "content": "ok"},
        {"role": "user", "content": last_env},
    ]
    latest, cleaned = extract_intents_from_messages(messages)
    assert latest is not None
    assert latest.action == "drilldown"
    assert latest.target == "a2"
    assert latest.label == "深入"
    # 信封剥离：首条 user 保留 "first"，末条 user 无自然语言时用 label 兜底
    assert cleaned[0]["content"] == "first"
    assert cleaned[2]["content"] == "深入"
    # assistant 消息原样保留
    assert cleaned[1]["content"] == "ok"


def test_extract_intents_preserves_non_user_and_envelope_free_messages():
    messages = [
        {"role": "user", "content": "plain question without intent"},
        {"role": "assistant", "content": "answer"},
    ]
    latest, cleaned = extract_intents_from_messages(messages)
    assert latest is None
    assert cleaned == messages


def test_to_context_block_contains_action_target_and_correction_hint():
    intent = Intent(action="filter", target="artifact-table", label="筛选前十", params={"top": 10})
    block = intent.to_context_block()
    assert "action: filter" in block
    assert "target: artifact-table" in block
    assert "predicted_label: 筛选前十" in block
    assert "params:" in block
    # 预判不准时应有修正路径提示
    assert "correct" in block


def test_empty_intent_produces_no_context_block():
    assert Intent().to_context_block() == ""


def test_params_truncation_for_oversized_payload():
    big = {"blob": "x" * 2000}
    intent = Intent(action="custom", params=big)
    block = intent.to_context_block()
    assert "truncated" in block
    assert len(block) < 4000


# ── 预判偏差记忆测试 ──────────────────────────────────────────

def test_record_prediction_miss_writes_sample_when_corrected_from_present(tmp_path):
    path = tmp_path / "misses.jsonl"
    rec = PredictionMissRecorder(path=path)
    actual = Intent(
        action="drilldown",
        target="artifact-sales",
        label="查看华东退货率",
        params={"corrected_from": {"action": "filter", "target": "artifact-sales", "label": "筛选销售额"}},
    )
    written = rec.record(predicted=actual.params["corrected_from"], actual=actual, context="华东区")
    assert written == path
    assert path.exists()
    import json
    line = path.read_text(encoding="utf-8").strip()
    sample = json.loads(line)
    assert sample["predicted"]["action"] == "filter"
    assert sample["actual"]["action"] == "drilldown"
    assert sample["actual"]["label"] == "查看华东退货率"
    assert sample["context"] == "华东区"


def test_record_prediction_miss_skips_empty_intent(tmp_path):
    path = tmp_path / "misses.jsonl"
    rec = PredictionMissRecorder(path=path)
    result = rec.record(predicted={"action": "x"}, actual=Intent(), context="")
    assert result is None
    assert not path.exists()


def test_recorder_recent_returns_latest_in_reverse(tmp_path):
    path = tmp_path / "misses.jsonl"
    rec = PredictionMissRecorder(path=path)
    for i in range(3):
        rec.record(
            predicted={"action": "p", "label": f"pred-{i}"},
            actual=Intent(action="a", target=f"t{i}"),
        )
    recent = rec.recent(limit=2)
    assert len(recent) == 2
    # 倒序：最近写的在前
    assert recent[0]["actual"]["target"] == "t2"
    assert recent[1]["actual"]["target"] == "t1"


def test_record_prediction_miss_if_any_detects_corrected_from(tmp_path):
    path = tmp_path / "misses.jsonl"
    # 临时替换全局 recorder 的路径
    from app.agent import intent as intent_mod
    orig = intent_mod.prediction_miss_recorder
    intent_mod.prediction_miss_recorder = PredictionMissRecorder(path=path)
    try:
        actual = Intent(
            action="correct",
            target="artifact-x",
            prompt="我要看退货率",
            params={"corrected_from": {"action": "filter", "target": "artifact-x"}},
        )
        written = record_prediction_miss_if_any(actual, context="修正")
        assert written == path
        assert path.exists()
    finally:
        intent_mod.prediction_miss_recorder = orig


def test_record_prediction_miss_if_any_ignores_plain_intent(tmp_path):
    path = tmp_path / "misses.jsonl"
    from app.agent import intent as intent_mod
    orig = intent_mod.prediction_miss_recorder
    intent_mod.prediction_miss_recorder = PredictionMissRecorder(path=path)
    try:
        # 没有 corrected_from 的普通意图不记录
        result = record_prediction_miss_if_any(Intent(action="open", target="a1"), context="")
        assert result is None
        assert not path.exists()
    finally:
        intent_mod.prediction_miss_recorder = orig


def test_build_prediction_miss_context_block_empty_when_no_samples(tmp_path):
    from app.agent import intent as intent_mod
    orig = intent_mod.prediction_miss_recorder
    intent_mod.prediction_miss_recorder = PredictionMissRecorder(path=tmp_path / "none.jsonl")
    try:
        assert build_prediction_miss_context_block() == ""
    finally:
        intent_mod.prediction_miss_recorder = orig


def test_build_prediction_miss_context_block_lists_samples(tmp_path):
    from app.agent import intent as intent_mod
    orig = intent_mod.prediction_miss_recorder
    rec = PredictionMissRecorder(path=tmp_path / "m.jsonl")
    intent_mod.prediction_miss_recorder = rec
    try:
        rec.record(
            predicted={"action": "filter", "target": "artifact-sales"},
            actual=Intent(action="drilldown", target="artifact-sales", label="看明细"),
        )
        block = build_prediction_miss_context_block()
        assert "Prediction Misses" in block
        assert "filter" in block
        assert "drilldown" in block
        assert "看明细" in block
    finally:
        intent_mod.prediction_miss_recorder = orig
