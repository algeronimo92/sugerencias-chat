from services.db_service import merge_poll_results_payload


def test_repeated_vote_is_idempotent():
    payload = {"values": ["AM", "PM"]}
    payload = merge_poll_results_payload(
        payload, [{"option": "AM"}], voter_id="ana", mode="delta"
    )
    payload = merge_poll_results_payload(
        payload, [{"option": "AM"}], voter_id="ana", mode="delta"
    )

    assert payload["results"] == [{"option": "AM", "count": 1}]


def test_changing_and_removing_vote_recalculates_counts():
    payload = merge_poll_results_payload(
        None, [{"option": "AM"}], voter_id="ana", mode="delta"
    )
    payload = merge_poll_results_payload(
        payload, [{"option": "PM"}], voter_id="ana", mode="delta"
    )
    assert payload["results"] == [{"option": "PM", "count": 1}]

    payload = merge_poll_results_payload(
        payload, [], voter_id="ana", mode="delta"
    )
    assert payload["results"] == []


def test_snapshot_replaces_previous_aggregate():
    payload = merge_poll_results_payload(
        {"results": [{"option": "AM", "count": 1}]},
        [{"option": "PM", "count": 3}],
    )

    assert payload["results"] == [{"option": "PM", "count": 3}]
