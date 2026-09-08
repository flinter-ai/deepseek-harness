from importlib.util import module_from_spec, spec_from_file_location
import pathlib
import stat
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).with_name("migrate-settings.py")
SPEC = spec_from_file_location("migrate_settings", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MIGRATE = module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATE)


SETTINGS = """agent-default-model:
  model: ark-code-latest
  provider: ark-agent-plan
llm-pi-ai:
  providers:
    ark-agent-plan:
      models:
        - id: ark-code-latest
          name: ARK Code Latest
          reasoningEfforts:
            high: high
    modelflare:
      models:
        - id: gpt-5.6-sol
"""


class MigrateSettingsTest(unittest.TestCase):
    def test_inserts_compat_only_under_the_ark_model(self) -> None:
        updated, changed = MIGRATE.converge(SETTINGS)
        self.assertTrue(changed)
        self.assertIn(
            "        - id: ark-code-latest\n"
            "          compat:\n"
            "            supportsDeveloperRole: false\n",
            updated,
        )
        self.assertNotIn("gpt-5.6-sol\n          compat", updated)

    def test_is_idempotent(self) -> None:
        once, _ = MIGRATE.converge(SETTINGS)
        twice, changed = MIGRATE.converge(once)
        self.assertFalse(changed)
        self.assertEqual(twice, once)

    def test_replaces_an_explicit_true_value(self) -> None:
        source = SETTINGS.replace(
            "          name: ARK Code Latest\n",
            "          compat:\n            supportsDeveloperRole: true\n          name: ARK Code Latest\n",
        )
        updated, changed = MIGRATE.converge(source)
        self.assertTrue(changed)
        self.assertIn("supportsDeveloperRole: false", updated)
        self.assertNotIn("supportsDeveloperRole: true", updated)

    def test_preserves_file_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "settings.yaml"
            path.write_text(SETTINGS)
            path.chmod(0o600)
            MIGRATE.atomic_write(path, MIGRATE.converge(SETTINGS)[0])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_fails_closed_without_the_exact_provider(self) -> None:
        with self.assertRaisesRegex(ValueError, "ark-agent-plan"):
            MIGRATE.converge("llm-pi-ai:\n  providers: {}\n")


if __name__ == "__main__":
    unittest.main()
