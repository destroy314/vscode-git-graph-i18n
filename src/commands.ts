import * as vscode from 'vscode';
import { AvatarManager } from './avatarManager';
import { getConfig } from './config';
import { DataSource } from './dataSource';
import { Event } from './event';
import { CodeReviewData, CodeReviews, ExtensionState } from './extensionState';
import { GitGraphView } from './gitGraphView';
import { Logger } from './logger';
import { RepoManager } from './repoManager';
import { abbrevCommit, abbrevText, getPathFromUri, getRelativeTimeDiff, getRepoName, GitExecutable, isPathInWorkspace, resolveToSymbolicPath, showErrorMessage, showInformationMessage, UNABLE_TO_FIND_GIT_MSG } from './utils';

export class CommandManager implements vscode.Disposable {
	private readonly extensionPath: string;
	private readonly avatarManager: AvatarManager;
	private readonly dataSource: DataSource;
	private readonly extensionState: ExtensionState;
	private readonly logger: Logger;
	private readonly repoManager: RepoManager;
	private gitExecutable: GitExecutable | null;
	private disposables: vscode.Disposable[] = [];

	constructor(extensionPath: string, avatarManger: AvatarManager, dataSource: DataSource, extensionState: ExtensionState, repoManager: RepoManager, gitExecutable: GitExecutable | null, onDidChangeGitExecutable: Event<GitExecutable>, logger: Logger) {
		this.extensionPath = extensionPath;
		this.avatarManager = avatarManger;
		this.dataSource = dataSource;
		this.extensionState = extensionState;
		this.logger = logger;
		this.repoManager = repoManager;
		this.gitExecutable = gitExecutable;

		this.registerCommand('git-graph.view', (arg) => this.view(arg));
		this.registerCommand('git-graph.addGitRepository', () => this.addGitRepository());
		this.registerCommand('git-graph.removeGitRepository', () => this.removeGitRepository());
		this.registerCommand('git-graph.clearAvatarCache', () => this.clearAvatarCache());
		this.registerCommand('git-graph.endAllWorkspaceCodeReviews', () => this.endAllWorkspaceCodeReviews());
		this.registerCommand('git-graph.endSpecificWorkspaceCodeReview', () => this.endSpecificWorkspaceCodeReview());
		this.registerCommand('git-graph.resumeWorkspaceCodeReview', () => this.resumeWorkspaceCodeReview());

		onDidChangeGitExecutable((gitExecutable) => {
			this.gitExecutable = gitExecutable;
		}, this.disposables);
	}

	public dispose() {
		this.disposables.forEach((disposable) => disposable.dispose());
		this.disposables = [];
	}

	private registerCommand(command: string, callback: (...args: any[]) => any) {
		this.disposables.push(vscode.commands.registerCommand(command, callback));
	}


	/* Commands */

	private async view(arg: any) {
		let loadRepo: string | null = null;

		if (typeof arg === 'object' && arg.rootUri) {
			// If command is run from the Visual Studio Code Source Control View, load the specific repo
			const repoPath = getPathFromUri(arg.rootUri);
			loadRepo = await this.repoManager.getKnownRepo(repoPath);
			if (loadRepo === null) {
				// The repo is not currently known, add it
				loadRepo = (await this.repoManager.registerRepo(await resolveToSymbolicPath(repoPath), true)).root;
			}
		} else if (getConfig().openToTheRepoOfTheActiveTextEditorDocument && vscode.window.activeTextEditor) {
			// If the config setting is enabled, load the repo containing the active text editor document
			loadRepo = this.repoManager.getRepoContainingFile(getPathFromUri(vscode.window.activeTextEditor.document.uri));
		}

		GitGraphView.createOrShow(this.extensionPath, this.dataSource, this.extensionState, this.avatarManager, this.repoManager, this.logger, loadRepo !== null ? { repo: loadRepo, commitDetails: null } : null);
	}

	private addGitRepository() {
		if (this.gitExecutable === null) {
			showErrorMessage(UNABLE_TO_FIND_GIT_MSG);
			return;
		}

		vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false }).then(uris => {
			if (uris && uris.length > 0) {
				let path = getPathFromUri(uris[0]);
				if (isPathInWorkspace(path)) {
					this.repoManager.registerRepo(path, false).then(status => {
						if (status.error === null) {
							showInformationMessage('The repository "' + status.root! + '" was added to Git Graph.');
						} else {
							showErrorMessage(status.error + ' Therefore it could not be added to Git Graph.');
						}
					});
				} else {
					showErrorMessage('The folder "' + path + '" is not within the opened Visual Studio Code workspace, and therefore could not be added to Git Graph.');
				}
			}
		}, () => { });
	}

	private removeGitRepository() {
		if (this.gitExecutable === null) {
			showErrorMessage(UNABLE_TO_FIND_GIT_MSG);
			return;
		}

		let repoPaths = Object.keys(this.repoManager.getRepos());
		let items: vscode.QuickPickItem[] = repoPaths.map(path => ({ label: getRepoName(path), description: path }));

		vscode.window.showQuickPick(items, {
			placeHolder: 'Select a repository to remove from Git Graph:',
			canPickMany: false
		}).then((item) => {
			if (item && item.description !== undefined) {
				if (this.repoManager.ignoreRepo(item.description)) {
					showInformationMessage('The repository "' + item.label + '" was removed from Git Graph.');
				} else {
					showErrorMessage('The repository "' + item.label + '" is not known to Git Graph.');
				}
			}
		}, () => { });
	}

	private clearAvatarCache() {
		this.avatarManager.clearCache();
	}

	private endAllWorkspaceCodeReviews() {
		this.extensionState.endAllWorkspaceCodeReviews();
		showInformationMessage('Ended All Code Reviews in Workspace');
	}

	private endSpecificWorkspaceCodeReview() {
		const codeReviews = this.extensionState.getCodeReviews();
		if (Object.keys(codeReviews).length === 0) {
			showErrorMessage('There are no Code Reviews in progress within the current workspace.');
			return;
		}

		vscode.window.showQuickPick(this.getCodeReviewQuickPickItems(codeReviews), {
			placeHolder: 'Select the Code Review you want to end:',
			canPickMany: false
		}).then((item) => {
			if (item) {
				this.extensionState.endCodeReview(item.codeReviewRepo, item.codeReviewId).then((errorInfo) => {
					if (errorInfo === null) {
						showInformationMessage('Successfully ended Code Review "' + item.label + '".');
					} else {
						showErrorMessage(errorInfo);
					}
				}, () => { });
			}
		}, () => { });
	}

	private resumeWorkspaceCodeReview() {
		const codeReviews = this.extensionState.getCodeReviews();
		if (Object.keys(codeReviews).length === 0) {
			showErrorMessage('There are no Code Reviews in progress within the current workspace.');
			return;
		}

		vscode.window.showQuickPick(this.getCodeReviewQuickPickItems(codeReviews), {
			placeHolder: 'Select the Code Review you want to resume:',
			canPickMany: false
		}).then((item) => {
			if (item) {
				const commitHashes = item.codeReviewId.split('-');
				GitGraphView.createOrShow(this.extensionPath, this.dataSource, this.extensionState, this.avatarManager, this.repoManager, this.logger, {
					repo: item.codeReviewRepo,
					commitDetails: {
						commitHash: commitHashes[commitHashes.length > 1 ? 1 : 0],
						compareWithHash: commitHashes.length > 1 ? commitHashes[0] : null
					}
				});
			}
		}, () => { });
	}


	/* Helper Methods */

	private getCodeReviewQuickPickItems(codeReviews: CodeReviews) {
		return new Promise<CodeReviewQuickPickItem[]>((resolve, reject) => {
			const enrichedCodeReviews: { repo: string, id: string, review: CodeReviewData, fromCommitHash: string, toCommitHash: string }[] = [];
			const fetchCommits: { repo: string, commitHash: string }[] = [];

			Object.keys(codeReviews).forEach((repo) => {
				Object.keys(codeReviews[repo]).forEach((id) => {
					const commitHashes = id.split('-');
					commitHashes.forEach((commitHash) => fetchCommits.push({ repo: repo, commitHash: commitHash }));
					enrichedCodeReviews.push({
						repo: repo, id: id, review: codeReviews[repo][id],
						fromCommitHash: commitHashes[0], toCommitHash: commitHashes[commitHashes.length > 1 ? 1 : 0]
					});
				});
			});

			Promise.all(fetchCommits.map((fetch) => this.dataSource.getCommitSubject(fetch.repo, fetch.commitHash))).then(
				(subjects) => {
					const commitSubjects: { [repo: string]: { [commitHash: string]: string } } = {};
					subjects.forEach((subject, i) => {
						if (typeof commitSubjects[fetchCommits[i].repo] === 'undefined') {
							commitSubjects[fetchCommits[i].repo] = {};
						}
						commitSubjects[fetchCommits[i].repo][fetchCommits[i].commitHash] = subject !== null ? subject : '<Unknown Commit Subject>';
					});

					resolve(enrichedCodeReviews.sort((a, b) => b.review.lastActive - a.review.lastActive).map((codeReview) => {
						const fromSubject = commitSubjects[codeReview.repo][codeReview.fromCommitHash];
						const toSubject = commitSubjects[codeReview.repo][codeReview.toCommitHash];
						const isComparison = codeReview.fromCommitHash !== codeReview.toCommitHash;
						return {
							codeReviewRepo: codeReview.repo,
							codeReviewId: codeReview.id,
							label: getRepoName(codeReview.repo) + ': ' + abbrevCommit(codeReview.fromCommitHash) + (isComparison ? ' ↔ ' + abbrevCommit(codeReview.toCommitHash) : ''),
							description: getRelativeTimeDiff(Math.round(codeReview.review.lastActive / 1000)),
							detail: isComparison
								? abbrevText(fromSubject, 50) + ' ↔ ' + abbrevText(toSubject, 50)
								: fromSubject
						};
					}));
				},
				() => reject()
			);
		});
	}
}

interface CodeReviewQuickPickItem extends vscode.QuickPickItem {
	codeReviewRepo: string;
	codeReviewId: string;
}
