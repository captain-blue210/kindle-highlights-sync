import { App, Modal, Notice } from "obsidian";
import { t } from "../i18n"; // Import t function

export class AmazonLogoutModal extends Modal {
	constructor(
		app: App,
		private logout: () => Promise<void>,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("amazon-logout-modal");

		contentEl.createEl("h2", { text: t("modals.amazonLogout.title") });
		contentEl.createEl("p", {
			text: t("modals.amazonLogout.confirmationText"),
		});
		contentEl.createEl("p", {
			text: t("modals.amazonLogout.noteText"),
			cls: "mod-warning",
		});

		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		// Logout Button
		const logoutButton = buttonContainer.createEl("button", {
			text: t("modals.amazonLogout.buttons.logout"),
			cls: "mod-cta", // Call to action style
		});
		logoutButton.onclick = async () => {
			new Notice(t("modals.amazonLogout.loggingOut"));
			this.close(); // Close modal first
			try {
				await this.logout(); // Pass region to logout method
				// Notice for successful logout should be handled by the service or here if needed
			} catch (error) {
				new Notice(
					t("modals.amazonLogout.errors.logoutFailed", {
						errorMessage: "Session could not be cleared",
					}),
				);
			}
		};

		// Cancel Button
		const cancelButton = buttonContainer.createEl("button", {
			text: t("modals.amazonLogout.buttons.cancel"),
		});
		cancelButton.onclick = () => {
			this.close();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
