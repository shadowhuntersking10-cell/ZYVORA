"""i18n coverage: every key translated in uz/en/ru; landing renders in all 3."""


def test_all_keys_in_all_langs():
    from app.i18n import LANGS, T

    missing = []
    for key, values in T.items():
        for lang in LANGS:
            if not values.get(lang):
                missing.append((key, lang))
    assert not missing, f"missing translations: {missing[:10]}"


def test_normalize_lang():
    from app.i18n import normalize_lang

    assert normalize_lang("RU") == "ru"
    assert normalize_lang("uzb") == "uz"
    assert normalize_lang("de") == "uz"
    assert normalize_lang(None) == "uz"


def test_format_args():
    from app.i18n import t

    assert t("en", "ai.cost", cost=7) == "Cost: 7 credits"
    assert t("ru", "ai.cost", cost=3) == "Цена: 3 кредитов"


def test_landing_all_langs(client):
    for lang, marker in [("uz", "Kreativ"), ("en", "creative"), ("ru", "творческие")]:
        r = client.get(f"/?lang={lang}")
        assert r.status_code == 200
        assert marker.lower() in r.text.lower()


def test_i18n_api(client):
    r = client.get("/api/i18n/en")
    data = r.json()
    assert data["lang"] == "en"
    assert data["pack"]["common.save"] == "Save"
