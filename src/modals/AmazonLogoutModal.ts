import { App, Modal, Notice } from "obsidian";
import { KindleApiService } from "../services/kindle-api";

export class AmazonLogoutModal extends Modal {
	constructor(
		app: App,
		private kindleApiService: KindleApiService,
		private region: string // Add region parameter
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("amazon-logout-modal");

		contentEl.createEl("h2", { text: "Amazon Logout Confirmation" });
		contentEl.createEl("p", {
			text: "Are you sure you want to log out from your Amazon Kindle session within Obsidian?",
		});
		contentEl.createEl("p", {
			text: "Note: This attempts to clear the session. You may need to log in again next time.",
			cls: "mod-warning",
		});

		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		// Logout Button
		const logoutButton = buttonContainer.createEl("button", {
			text: "Logout",
			cls: "mod-cta", // Call to action style
		});
		logoutButton.onclick = async () => {
			new Notice("Logging out...");
			this.close(); // Close modal first
			try {
				await this.kindleApiService.logout(this.region); // Pass region to logout method
				// Notice is handled within the service logout method now
			} catch (error) {
				console.error("Error during logout:", error);
				new Notice(`Logout failed: ${error.message}`);
			}
		};

		// Cancel Button
		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
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
