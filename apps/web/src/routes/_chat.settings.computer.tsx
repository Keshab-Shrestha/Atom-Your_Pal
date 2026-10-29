import { createFileRoute } from "@tanstack/react-router";
import { ArkComputerSettings } from "../components/ark/ArkComputer";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { SettingsScopeNotice } from "../components/settings/SettingsScopeNotice";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsComputerRoute() {
  const { scope, environment } = useSettingsScope();
  if (scope.kind !== "environment" || !environment)
    return (
      <SettingsScopeNotice target="environment" targetId="computer-use">
        Choose the environment whose apps and computer decisions you want to control.
      </SettingsScopeNotice>
    );
  return (
    <SettingsPageContainer>
      <ArkComputerSettings environmentId={environment.environmentId} />
    </SettingsPageContainer>
  );
}
export const Route = createFileRoute("/_chat/settings/computer")({
  component: SettingsComputerRoute,
});
