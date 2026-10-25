"""Smoke tests for the GTK GUI's non-GTK modules. No network, no display."""

from src.design.colors import ThemeManager
from src.services.api_client import APIClient
from src.services.settings_manager import SettingsManager


def test_api_client_normalizes_base_url():
    client = APIClient("http://localhost:3000/")
    assert client.base_url == "http://localhost:3000"

    client.set_base_url("http://127.0.0.1:8080/")
    assert client.base_url == "http://127.0.0.1:8080"


def test_settings_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))

    settings = SettingsManager()
    assert settings.get("api_url") == "http://localhost:3000"

    settings.set("refresh_interval", 60)
    assert settings.save()

    reloaded = SettingsManager()
    assert reloaded.get("refresh_interval") == 60
    assert reloaded.settings_file.is_relative_to(tmp_path)


def test_theme_color_helpers():
    theme = ThemeManager()
    assert theme.get_rgba("#ffffff") == "rgba(1.000, 1.000, 1.000, 1.000)"
    assert theme.lighten_color("#000000", 1.0) == "#ffffff"
