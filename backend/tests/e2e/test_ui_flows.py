"""
E2E UI flow tests — run against the live local server with seeded dummy data.

These tests validate high-level user journeys using a real browser (Playwright).
No LLM calls are made; all AI responses come from the seed data.

Run:
    pytest tests/e2e/test_ui_flows.py -m e2e          # from backend/
    make test-e2e                                       # from project root
"""

import pytest
from playwright.sync_api import Page, expect


pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def login(page: Page, base_url: str) -> None:
    """Navigate to the app and complete the login form."""
    page.goto(base_url)
    page.get_by_label("Username").fill("admin")
    page.get_by_label("Password").fill("tangents")
    page.get_by_role("button", name="Sign in").click()
    # Wait for the main shell to appear
    page.wait_for_selector("[data-testid='app-shell'], nav, [class*='sidebar']", timeout=10_000)


# ---------------------------------------------------------------------------
# Auth tests
# ---------------------------------------------------------------------------

class TestAuth:
    def test_login_gate_renders_before_auth(self, page: Page, e2e_server) -> None:
        page.goto(e2e_server.base_url)
        expect(page.get_by_text("Sign in to Tangents")).to_be_visible()

    def test_login_with_wrong_password_shows_error(self, page: Page, e2e_server) -> None:
        page.goto(e2e_server.base_url)
        page.get_by_label("Username").fill("admin")
        page.get_by_label("Password").fill("wrongpassword")
        page.get_by_role("button", name="Sign in").click()
        expect(page.get_by_text("Invalid username or password.")).to_be_visible()

    def test_successful_login_shows_app_shell(self, page: Page, e2e_server) -> None:
        login(page, e2e_server.base_url)
        # After login the login gate should be gone
        expect(page.get_by_text("Sign in to Tangents")).not_to_be_visible()


# ---------------------------------------------------------------------------
# Chat list tests
# ---------------------------------------------------------------------------

class TestChatList:
    def test_seeded_chat_appears_in_sidebar(self, page: Page, e2e_server) -> None:
        login(page, e2e_server.base_url)
        expect(page.get_by_text("E2E seed chat")).to_be_visible(timeout=5_000)

    def test_clicking_chat_loads_it(self, page: Page, e2e_server) -> None:
        login(page, e2e_server.base_url)
        page.get_by_text("E2E seed chat").click()
        # History should render — check for one of the seed prompts
        expect(page.get_by_text("Root question")).to_be_visible(timeout=5_000)


# ---------------------------------------------------------------------------
# Graph view tests
# ---------------------------------------------------------------------------

class TestGraphView:
    def test_graph_tab_renders_nodes(self, page: Page, e2e_server) -> None:
        login(page, e2e_server.base_url)
        # Select the seed chat first
        page.get_by_text("E2E seed chat").click()
        # Switch to the Graph tab in the sidebar
        page.get_by_role("tab", name="Graph").click()
        # React Flow canvas should be present
        expect(page.locator(".react-flow")).to_be_visible(timeout=8_000)

    def test_graph_shows_correct_branch_tooltip(self, page: Page, e2e_server) -> None:
        login(page, e2e_server.base_url)
        page.get_by_text("E2E seed chat").click()
        page.get_by_role("tab", name="Graph").click()
        # Hover a branch-head dot to trigger the tooltip
        dot = page.locator(".react-flow [title='main']").first
        dot.hover()
        expect(page.get_by_text("main")).to_be_visible(timeout=5_000)


# ---------------------------------------------------------------------------
# Settings page tests
# ---------------------------------------------------------------------------

class TestSettingsPage:
    def test_settings_page_opens_from_sidebar(self, page: Page, e2e_server) -> None:
        login(page, e2e_server.base_url)
        page.get_by_role("button", name="Settings").click()
        expect(page.get_by_text("Model Sources")).to_be_visible(timeout=5_000)

    def test_seeded_model_source_shown(self, page: Page, e2e_server) -> None:
        login(page, e2e_server.base_url)
        page.get_by_role("button", name="Settings").click()
        expect(page.get_by_text("Test OpenAI")).to_be_visible(timeout=5_000)


# ---------------------------------------------------------------------------
# Compose mode / new chat tests
# ---------------------------------------------------------------------------

class TestComposeMode:
    def test_new_chat_shows_compose_prompt(self, page: Page, e2e_server) -> None:
        login(page, e2e_server.base_url)
        # Click the "New chat" button (exact text may vary — look for a + / New icon)
        page.get_by_role("button", name="+").click()
        expect(page.get_by_text("Start a new conversation below")).to_be_visible(timeout=5_000)

    def test_message_input_present_in_compose_mode(self, page: Page, e2e_server) -> None:
        login(page, e2e_server.base_url)
        page.get_by_role("button", name="+").click()
        expect(page.get_by_role("textbox")).to_be_visible(timeout=5_000)
