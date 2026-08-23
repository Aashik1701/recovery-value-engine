from app.guardrails import apply_guardrails, full_menu, scan_for_dark_patterns
from app.models import NON_CONTACT_INTERVENTIONS, VOICE_CALL_AMOUNT_THRESHOLD


def test_voice_call_blocked_below_threshold() -> None:
    eligible, blocked = apply_guardrails(
        full_menu(), amount=VOICE_CALL_AMOUNT_THRESHOLD - 1, customer_id="c1", suppression_list=set()
    )
    assert "voice_call" not in eligible
    assert "voice_call" in blocked


def test_voice_call_eligible_at_or_above_threshold() -> None:
    eligible, blocked = apply_guardrails(
        full_menu(), amount=VOICE_CALL_AMOUNT_THRESHOLD, customer_id="c1", suppression_list=set()
    )
    assert "voice_call" in eligible
    assert "voice_call" not in blocked


def test_suppressed_customer_only_gets_non_contact_interventions() -> None:
    eligible, blocked = apply_guardrails(
        full_menu(), amount=10000, customer_id="c1", suppression_list={"c1"}
    )
    assert set(eligible) == NON_CONTACT_INTERVENTIONS
    for contact_intervention in set(full_menu()) - NON_CONTACT_INTERVENTIONS:
        assert contact_intervention in blocked


def test_non_suppressed_customer_unaffected_by_suppression_list() -> None:
    eligible, blocked = apply_guardrails(
        full_menu(), amount=10000, customer_id="c2", suppression_list={"someone_else"}
    )
    assert "sms_link" in eligible
    assert "whatsapp_nudge" in eligible


def test_contact_frequency_cap_blocks_contact_interventions_when_reached() -> None:
    eligible, blocked = apply_guardrails(
        full_menu(), amount=10000, customer_id="c1", suppression_list=set(), prior_contact_count=2
    )
    assert set(eligible) == NON_CONTACT_INTERVENTIONS
    assert "sms_link" in blocked


def test_no_action_always_eligible() -> None:
    eligible, _ = apply_guardrails(
        full_menu(), amount=1, customer_id="c1", suppression_list={"c1"}, prior_contact_count=2
    )
    assert "no_action" in eligible


def test_dark_pattern_scan_flags_known_phrases() -> None:
    matches = scan_for_dark_patterns("Act now! This is your last chance to recover the payment.")
    assert "act now" in matches
    assert "last chance" in matches


def test_dark_pattern_scan_clean_text_returns_empty() -> None:
    matches = scan_for_dark_patterns(
        "We recommend a retry for this transient bank timeout given the customer's high past success rate."
    )
    assert matches == []
