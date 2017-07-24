/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IEditorContributionCtor } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/common/services/codeEditorService';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { EditorAction, CommonEditorRegistry } from 'vs/editor/common/editorCommonExtensions';
import { EditorBrowserRegistry } from 'vs/editor/browser/editorBrowserExtensions';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { IPosition } from 'vs/editor/common/core/position';
import { IRange } from 'vs/editor/common/core/range';
import { TPromise } from 'vs/base/common/winjs.base';
import { IDisposable } from 'vs/base/common/lifecycle';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { DocumentSymbolProviderRegistry, SymbolInformation, SymbolKind } from 'vs/editor/common/modes';

export class CodeEditor extends CodeEditorWidget {

	private containerDomElement: HTMLElement;
	private toolbarDomElement: HTMLElement;
	private editorContainerDomElement: HTMLElement;
	private editorDomElement: HTMLElement;

	private updateToolbarTimeout;
	private updateToolbarClosure;
	private updateToolbarTokenSource: CancellationTokenSource;
	private allSymbolsSorted: SymbolInformation[];
	private breadcrumbSymbols: SymbolInformation[];
	private disposeCursorPositionEvent: IDisposable;
	private disposeContentEditEvent: IDisposable;

	constructor(
		domElement: HTMLElement,
		options: IEditorOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService
	) {
		const parentWrapperElement = domElement;

		const toolbarHeight = '2em';

		const containerDomElement = document.createElement('div');
		containerDomElement.style.cssText = `
		position: relative;
		width: 100%; height: 100%;
		`;

		const editorContainerDomElement = document.createElement('div');
		editorContainerDomElement.style.cssText = `
		position: absolute;
		top: 0; left: 0; width: 100%; height: 100%;
		padding-top: ${toolbarHeight};
		`;
		const editorDomElement = document.createElement('div');
		editorContainerDomElement.appendChild(editorDomElement);
		containerDomElement.appendChild(editorContainerDomElement);

		const toolbarDomElement = document.createElement('div');
		toolbarDomElement.style.cssText = `
		position: absolute;
		top: 0; left: 0; width: 100%; height: ${toolbarHeight};
		padding-top: 0.6em;
		padding-left: 1em;
		background: linear-gradient(#1e1e1e, black);
		`;
		toolbarDomElement.innerHTML = 'toolbar <button> ok </button> <button> cancel </button>';
		containerDomElement.appendChild(toolbarDomElement);

		parentWrapperElement.appendChild(containerDomElement);

		super(editorDomElement, options, instantiationService, codeEditorService, commandService, contextKeyService, themeService);

		this.containerDomElement = containerDomElement;
		this.toolbarDomElement = toolbarDomElement;
		this.editorContainerDomElement = editorContainerDomElement;
		this.editorDomElement = editorDomElement;

		this.disposeCursorPositionEvent = this.onDidChangeCursorPosition(() => {
			this.queueUpdateToolbar();
		});

		this.queueUpdateToolbar();
	}

	public dispose(): void {
		if (this.disposeContentEditEvent) {
			this.disposeContentEditEvent.dispose();
			this.disposeContentEditEvent = null;
		}

		super.dispose();
	}


	protected _getContributions(): IEditorContributionCtor[] {
		return [].concat(EditorBrowserRegistry.getEditorContributions()).concat(CommonEditorRegistry.getEditorContributions());
	}

	protected _getActions(): EditorAction[] {
		return CommonEditorRegistry.getEditorActions();
	}

	private queueUpdateToolbar(): void {
		if (this.updateToolbarTimeout) {
			clearTimeout(this.updateToolbarTimeout);
		}

		if (!this.updateToolbarClosure) {
			this.updateToolbarClosure = () => this.updateToolbar();
		}

		setTimeout(this.updateToolbarClosure, 100);
	}

	private updateToolbar(): void {
		if (this.allSymbolsSorted && this.allSymbolsSorted.length) {
			this.updateToolbarWithSymbols(this.allSymbolsSorted);
			return;
		}

		const model = this.getModel();
		const provider = model && DocumentSymbolProviderRegistry.ordered(model)[0];
		if (!provider) {
			this.clearToolbar();
			return;
		}

		const tokenSource = new CancellationTokenSource();
		this.updateToolbarTokenSource = tokenSource;

		const symbolsOrPromise = provider.provideDocumentSymbols(model, CancellationToken.None);
		if (TPromise.is(symbolsOrPromise)) {
			symbolsOrPromise.then(symbols => {
				if (this.updateToolbarTokenSource !== tokenSource) {
					return;
				}

				this.updateToolbarWithSymbols(symbols);
			});
		}
		else {
			this.updateToolbarWithSymbols(symbolsOrPromise);
		}

	}

	private static compareSymbols(s1: SymbolInformation, s2: SymbolInformation): number {
		const r1 = s1.location && s1.location.range;
		const r2 = s2.location && s2.location.range;

		const startLineNumber1 = r1 && r1.startLineNumber;
		const startLineNumber2 = r2 && r2.startLineNumber;
		if (startLineNumber1 > startLineNumber2) {
			return +1;
		}
		else if (startLineNumber1 < startLineNumber2) {
			return -1;
		}

		const startColumn1 = r1 && r1.startColumn;
		const startColumn2 = r2 && r2.startColumn;
		if (startColumn1 > startColumn2) {
			return +1;
		}
		else if (startColumn1 < startColumn2) {
			return -1;
		}

		const endLineNumber1 = r1 && r1.endLineNumber;
		const endLineNumber2 = r2 && r2.endLineNumber;
		if (endLineNumber1 > endLineNumber2) {
			return -1;
		}
		else if (endLineNumber1 < endLineNumber2) {
			return +1;
		}

		const endColumn1 = r1 && r1.endColumn;
		const endColumn2 = r2 && r2.endColumn;
		if (endColumn1 > endColumn2) {
			return -1;
		}
		else if (endColumn1 < endColumn2) {
			return +1;
		}

		return 0;
	}

	private updateToolbarWithSymbols(symbols: SymbolInformation[]): void {
		if (!symbols) {
			this.clearToolbar();
			return;
		}

		symbols.sort(CodeEditor.compareSymbols);

		const position = this.getPosition();

		let matchingSymbols: SymbolInformation[] = [];
		for (var i = 0; i < symbols.length; i++) {
			const sym = symbols[i];
			const symRange = sym.location && sym.location.range;
			if (!symRange) {
				continue;
			}

			if (this.positionWithinRange(position, symRange)) {
				matchingSymbols.push(sym);
			}
		}

		this.updateWithBreadcrumbSymbols(matchingSymbols);
	}

	private updateWithBreadcrumbSymbols(matchingSymbols: SymbolInformation[]) {
		const highlightSymbol = matchingSymbols[matchingSymbols.length - 1];
		let extraSymbolsTrail: SymbolInformation[];
		if (this.breadcrumbSymbols
			&& matchingSymbols.length
			&& this.breadcrumbSymbols.length > matchingSymbols.length) {
			extraSymbolsTrail = this.breadcrumbSymbols.slice(matchingSymbols.length);

			// all leading symbols should match location
			for (var i = 0; i < matchingSymbols.length; i++) {
				if (!this.rangeWithinRange(this.breadcrumbSymbols[i].location.range, matchingSymbols[i].location.range)
					|| !this.rangeWithinRange(matchingSymbols[i].location.range, this.breadcrumbSymbols[i].location.range)) {
					extraSymbolsTrail = null;
					break;
				}
			}

			// all trail symbols should be inside the last matching symbol
			if (extraSymbolsTrail) {
				for (var i = 0; i < extraSymbolsTrail.length; i++) {
					if (!this.rangeWithinRange(extraSymbolsTrail[i].location.range, highlightSymbol.location.range)) {
						extraSymbolsTrail = null;
						break;
					}
				}
			}

			if (extraSymbolsTrail) {
				matchingSymbols = matchingSymbols.concat(extraSymbolsTrail);
			}
		}

		this.breadcrumbSymbols = matchingSymbols;

		const position = this.getPosition();

		for (var i = 0; i < matchingSymbols.length; i++) {
			const sym = matchingSymbols[i];
			if (!this.positionWithinRange(position, sym.location.range)) {
				continue;
			}
		}

		this.clearToolbar();
		for (var i = 0; i < matchingSymbols.length; i++) {
			if (i) {
				const sep = document.createElement('span');
				sep.textContent = '>';
				sep.style.cssText = 'opacity: 0.5; cursor: default; margin-left: 0.5em; margin-right: 0.5em;';
				this.toolbarDomElement.appendChild(sep);
			}

			const sym = matchingSymbols[i];

			const symSpan = document.createElement('span');
			symSpan.style.cssText = 'cursor: pointer;';
			if (sym === highlightSymbol) {
				symSpan.style.color = 'gold';
			}
			else if (extraSymbolsTrail && i > matchingSymbols.length - extraSymbolsTrail.length) {
				symSpan.style.opacity = '0.7';
			}

			symSpan.onclick = () => {
				const newPos = {
					lineNumber: sym.location.range.startLineNumber,
					column: sym.location.range.startColumn
				};
				this.setPosition(newPos);
				const visibleRange = this.getCompletelyVisibleLinesRangeInViewport();
				if (!this.positionWithinRange(newPos, visibleRange)) {
					const posTop = this.getTopForLineNumber(newPos.lineNumber);
					this.setScrollTop(posTop - 10);
				}

				setTimeout(() => {
					this.focus();
				}, 1);
			};
			symSpan.textContent = sym.name;
			symSpan.title = SymbolKind[sym.kind] + ' @' + sym.containerName;
			this.toolbarDomElement.appendChild(symSpan);
		}

	}

	private positionWithinRange(position: IPosition, withinRange: IRange) {
		return this.positionPairWithinRange(position.lineNumber, position.column, withinRange);
	}

	private positionPairWithinRange(lineNumber: number, column: number, withinRange: IRange) {
		if (lineNumber > withinRange.startLineNumber
			|| (lineNumber === withinRange.startLineNumber && column >= withinRange.startColumn)) {
			if (lineNumber < withinRange.endLineNumber
				|| (lineNumber === withinRange.endLineNumber && column && column <= withinRange.endColumn)) {
				return true;
			}
		}

		return false;
	}

	private rangeWithinRange(testRange: IRange, withinRange: IRange) {
		return this.positionPairWithinRange(testRange.startLineNumber, testRange.startColumn, withinRange) &&
			this.positionPairWithinRange(testRange.endLineNumber, testRange.endColumn, withinRange);
	}

	_attachModel(model: editorCommon.IModel): void {
		if (this.disposeContentEditEvent) {
			this.disposeContentEditEvent.dispose();
			this.disposeContentEditEvent = null;
		}
		this.allSymbolsSorted = null;
		this.queueUpdateToolbar();
		super._attachModel(model);
		if (model) {
			this.disposeContentEditEvent = model.onDidChangeContent(() => {
				this.allSymbolsSorted = null;
				this.queueUpdateToolbar();
			});
		}
	}

	private clearToolbar() {
		if (this.toolbarDomElement.firstChild) {
			this.toolbarDomElement.innerHTML = '';
		}
	}
}
