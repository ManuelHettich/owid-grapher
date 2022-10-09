import { observer } from "mobx-react"
import React from "react"
import { HotTable } from "@handsontable/react"
import { action, observable, computed } from "mobx"
import {
    ExplorerProgram,
    EXPLORER_FILE_SUFFIX,
    makeFullPath,
} from "../explorer/ExplorerProgram.js"
import { GitCmsClient } from "../gitCms/GitCmsClient.js"
import { Prompt } from "react-router-dom"
import Handsontable from "handsontable"
import { CoreMatrix } from "@ourworldindata/core-table"
import {
    exposeInstanceOnWindow,
    slugify,
    toRectangularMatrix,
} from "@ourworldindata/utils"
import { LoadingIndicator } from "../grapher/loadingIndicator/LoadingIndicator.js"
import {
    DefaultNewExplorerSlug,
    ExplorerChoiceParams,
    EXPLORERS_PREVIEW_ROUTE,
    UNSAVED_EXPLORER_DRAFT,
    UNSAVED_EXPLORER_PREVIEW_QUERYPARAMS,
} from "../explorer/ExplorerConstants.js"
import {
    AutofillColDefCommand,
    InlineDataCommand,
    SelectAllHitsCommand,
} from "./ExplorerCommands.js"
import { isEmpty } from "../gridLang/GrammarUtils.js"
import classNames from "classnames"
import { GitCmsFile, GIT_CMS_BASE_ROUTE } from "../gitCms/GitCmsConstants.js"
import { AdminManager } from "./AdminManager.js"
import { registerAllModules } from "handsontable/registry"

const RESERVED_NAMES = [DefaultNewExplorerSlug, "index", "new", "create"] // don't allow authors to save explorers with these names, otherwise might create some annoying situations.

// Register all Handsontable modules
registerAllModules()

@observer
export class ExplorerCreatePage extends React.Component<{
    slug: string
    gitCmsBranchName: string
    manager?: AdminManager
    doNotFetch?: boolean // for testing
}> {
    disposers: Array<() => void> = []

    @computed private get manager() {
        return this.props.manager ?? {}
    }

    @action.bound private loadingModalOff() {
        this.manager.loadingIndicatorSetting = "off"
    }

    @action.bound private loadingModalOn() {
        this.manager.loadingIndicatorSetting = "loading"
    }

    @action.bound private resetLoadingModal() {
        this.manager.loadingIndicatorSetting = "default"
    }

    @action componentDidMount() {
        this.loadingModalOff()
        exposeInstanceOnWindow(this, "explorerEditor")

        if (this.props.doNotFetch) return

        this.fetchExplorerProgramOnLoad()
        this.startPollingLocalStorageForPreviewChanges()
    }

    @action.bound private startPollingLocalStorageForPreviewChanges() {
        const intervalId = setInterval(() => {
            const savedQueryParamsJSON = localStorage.getItem(
                `${UNSAVED_EXPLORER_PREVIEW_QUERYPARAMS}${this.program.slug}`
            )
            if (typeof savedQueryParamsJSON === "string")
                this.program.decisionMatrix.setValuesFromChoiceParams(
                    JSON.parse(savedQueryParamsJSON) as ExplorerChoiceParams
                )
        }, 1000)
        this.disposers.push(() => clearInterval(intervalId))
    }

    @observable isReady = false

    @action componentWillUnmount() {
        this.resetLoadingModal()
        this.disposers.forEach((disposer) => disposer())
    }

    private gitCmsClient = new GitCmsClient(GIT_CMS_BASE_ROUTE)

    @action.bound private async fetchExplorerProgramOnLoad() {
        const { slug } = this.props
        const response = await this.gitCmsClient.readRemoteFile({
            filepath: makeFullPath(slug),
        })
        this.programOnDisk = new ExplorerProgram("", response.content ?? "")
        this.setProgram(this.draftIfAny ?? this.programOnDisk.toString())
        this.isReady = true
        if (this.isModified)
            alert(
                `Your browser has a changed draft of '${slug}'. If you want to clear your local changes, click the "Clear Changes" button in the top right.`
            )
    }

    @action.bound private setProgram(code: string) {
        this.program = new ExplorerProgram(this.program.slug, code)
        this.saveDraft(code)
    }

    private saveDraft(code: string) {
        localStorage.setItem(UNSAVED_EXPLORER_DRAFT + this.program.slug, code)
    }

    get draftIfAny() {
        return localStorage.getItem(UNSAVED_EXPLORER_DRAFT + this.program.slug)
    }

    private clearDraft() {
        localStorage.removeItem(UNSAVED_EXPLORER_DRAFT + this.program.slug)
    }

    @observable.ref private programOnDisk = new ExplorerProgram("", "")

    @observable.ref private program = new ExplorerProgram(this.props.slug, "")

    @action.bound private async _save(slug: string, commitMessage: string) {
        this.loadingModalOn()
        this.program.slug = slug
        const res = await this.gitCmsClient.writeRemoteFile({
            filepath: this.program.fullPath,
            content: this.program.toString(),
            commitMessage,
        })
        if (!res.success) {
            alert(`Saving the explorer failed!\n\n${res.error}`)
            return
        }

        this.loadingModalOff()
        this.programOnDisk = new ExplorerProgram("", this.program.toString())
        this.setProgram(this.programOnDisk.toString())
        this.clearDraft()
    }

    @action.bound private async saveAs() {
        const userSlug = prompt(
            `Create a slug (URL friendly name) for this explorer. Your new file will be pushed to the '${this.props.gitCmsBranchName}' branch on GitHub.`,
            this.program.slug
        )
        if (!userSlug) return
        const slug = slugify(userSlug)
        if (!slug) {
            alert(`'${slug}' is not a valid slug`)
            return
        }
        if (new Set(RESERVED_NAMES).has(slug.toLowerCase())) {
            alert(
                `Cannot save '${userSlug}' because that is one of the reserved names: ${RESERVED_NAMES.join(
                    ", "
                )}`
            )
            return
        }
        await this._save(slug, `Saving ${this.program.slug} as ${slug}`)
        window.location.href = slug
    }

    @action.bound private clearChanges() {
        if (!confirm("Are you sure you want to clear your local changes?"))
            return

        this.setProgram(this.programOnDisk.toString())
        this.clearDraft()
    }

    @action.bound private async save() {
        const commitMessage = prompt(
            `Enter a message describing this change. Your change will be pushed to the '${this.props.gitCmsBranchName}' on GitHub.`,
            `Updated ${this.program.slug}`
        )
        if (!commitMessage) return
        await this._save(this.program.slug, commitMessage)
    }

    @computed get isModified() {
        return this.programOnDisk.toString() !== this.program.toString()
    }

    @observable gitCmsBranchName = this.props.gitCmsBranchName

    @action.bound private onSave() {
        if (this.program.isNewFile) this.saveAs()
        else if (this.isModified) this.save()
    }

    render() {
        if (!this.isReady) return <LoadingIndicator />

        const { program, isModified } = this
        const { isNewFile, slug } = program
        const previewLink = `/admin/${EXPLORERS_PREVIEW_ROUTE}/${slug}`

        const buttons = []

        buttons.push(
            <button
                key="save"
                disabled={!isModified && !isNewFile}
                className={classNames("btn", "btn-primary")}
                onClick={this.onSave}
                title="Saves file to disk, commits and pushes to GitHub"
            >
                Save
            </button>
        )

        buttons.push(
            <button
                key="saveAs"
                disabled={isNewFile}
                title={
                    isNewFile
                        ? "You need to save this file first."
                        : "Saves file to disk, commits and pushes to GitHub"
                }
                className={classNames("btn", "btn-secondary")}
                onClick={this.saveAs}
            >
                Save As
            </button>
        )

        buttons.push(
            <button
                key="clear"
                disabled={!isModified}
                title={isModified ? "" : "No changes"}
                className={classNames("btn", "btn-secondary")}
                onClick={this.clearChanges}
            >
                Clear Changes
            </button>
        )

        const modifiedMessage = isModified
            ? "Are you sure you want to leave? You have unsaved changes."
            : "" // todo: provide an explanation of how many cells are modified.

        return (
            <>
                <Prompt when={isModified} message={modifiedMessage} />
                <main
                    style={{
                        padding: 0,
                        position: "relative",
                    }}
                >
                    <div className="ExplorerCreatePageHeader">
                        <div>
                            <TemplatesComponent
                                onChange={this.setProgram}
                                isNewFile={isNewFile}
                            />
                        </div>
                        <div style={{ textAlign: "right" }}>{buttons}</div>
                    </div>
                    <HotEditor
                        onChange={this.setProgram}
                        program={program}
                        programOnDisk={this.programOnDisk}
                    />
                    <PictureInPicture previewLink={previewLink} />
                    <a className="PreviewLink" href={previewLink}>
                        Visit preview
                    </a>
                </main>
            </>
        )
    }
}

class HotEditor extends React.Component<{
    onChange: (code: string) => void
    program: ExplorerProgram
    programOnDisk: ExplorerProgram
}> {
    private hotTableComponent = React.createRef<HotTable>()

    @computed private get program() {
        return this.props.program
    }

    @computed private get programOnDisk() {
        return this.props.programOnDisk
    }

    @action.bound private updateProgramFromHot() {
        const newVersion =
            this.hotTableComponent.current?.hotInstance?.getData() as CoreMatrix
        if (!newVersion) return

        const newProgram = ExplorerProgram.fromMatrix(
            this.program.slug,
            newVersion
        )
        if (this.program.toString() === newProgram.toString()) return
        this.props.onChange(newProgram.toString())
    }

    private get hotSettings() {
        const { program, programOnDisk } = this

        // replace literal `\n` with newlines
        const data = program.asArrays.map((row) =>
            row.map((cell) => cell.replace(/\\n/g, "\n"))
        )

        const { currentlySelectedGrapherRow } = program

        const cells = function (row: number, column: number) {
            const {
                comment,
                cssClasses,
                optionKeywords,
                placeholder,
                contents,
            } = program.getCell({ row, column })

            const cellContentsOnDisk = programOnDisk.getCellContents({
                row,
                column,
            })

            const cellProperties: Partial<Handsontable.CellProperties> = {}

            const allClasses = cssClasses?.slice() ?? []

            if (cellContentsOnDisk !== contents) {
                if (contents === "" && cellContentsOnDisk === undefined)
                    allClasses.push("cellCreated")
                else if (isEmpty(contents)) allClasses.push("cellDeleted")
                else if (isEmpty(cellContentsOnDisk))
                    allClasses.push("cellCreated")
                else allClasses.push("cellChanged")
            }

            if (currentlySelectedGrapherRow === row && column)
                allClasses.push(`currentlySelectedGrapherRow`)

            cellProperties.className = allClasses.join(" ")
            cellProperties.comment = comment ? { value: comment } : undefined
            cellProperties.placeholder = placeholder

            if (optionKeywords && optionKeywords.length) {
                cellProperties.type = "autocomplete"
                cellProperties.source = optionKeywords
            }

            return cellProperties
        }

        const hotSettings: Handsontable.GridSettings = {
            afterChange: () => this.updateProgramFromHot(),
            afterRemoveRow: () => this.updateProgramFromHot(),
            afterRemoveCol: () => this.updateProgramFromHot(),
            allowInsertRow: true,
            autoRowSize: false,
            autoColumnSize: false,
            cells,
            colHeaders: true,
            comments: true,
            contextMenu: {
                items: {
                    AutofillColDefCommand: new AutofillColDefCommand(
                        program,
                        (newProgram: string) => this.props.onChange(newProgram)
                    ).toHotCommand(),
                    InlineDataCommand: new InlineDataCommand(
                        program,
                        (newProgram: string) => this.props.onChange(newProgram)
                    ).toHotCommand(),
                    SelectAllHitsCommand: new SelectAllHitsCommand(
                        program
                    ).toHotCommand(),
                    sp0: { name: "---------" },
                    row_above: {},
                    row_below: {},
                    sp1: { name: "---------" },
                    remove_row: {},
                    remove_col: {},
                    sp2: { name: "---------" },
                    undo: {},
                    redo: {},
                    sp3: { name: "---------" },
                    copy: {},
                    cut: {},
                },
            },
            data: toRectangularMatrix(data, undefined),
            height: "100%",
            manualColumnResize: true,
            manualRowMove: true,
            minCols: program.width + 3,
            minSpareCols: 2,
            minRows: 40,
            minSpareRows: 20,
            rowHeaders: true,
            search: true,
            stretchH: "all",
            width: "100%",
            wordWrap: false,
        }

        return hotSettings
    }

    render() {
        return (
            <HotTable
                settings={this.hotSettings}
                ref={this.hotTableComponent as any}
                licenseKey={"non-commercial-and-evaluation"}
            />
        )
    }
}

class PictureInPicture extends React.Component<{
    previewLink: string
}> {
    render() {
        return (
            <iframe
                src={this.props.previewLink}
                className="ExplorerPipPreview"
            />
        )
    }
}

class TemplatesComponent extends React.Component<{
    isNewFile: boolean
    onChange: (code: string) => void
}> {
    @action.bound private loadTemplate(filename: string) {
        this.props.onChange(
            this.templates.find((template) => template.filename === filename)!
                .content
        )
    }

    @observable.ref templates: GitCmsFile[] = []

    componentDidMount() {
        if (this.props.isNewFile) this.fetchTemplatesOnLoad()
    }

    private gitCmsClient = new GitCmsClient(GIT_CMS_BASE_ROUTE)

    @action.bound private async fetchTemplatesOnLoad() {
        const response = await this.gitCmsClient.readRemoteFiles({
            glob: "*template*",
            folder: "explorers",
        })
        this.templates = response.files
    }

    render() {
        return this.templates.map((template) => (
            <button
                className={classNames("btn", "btn-primary")}
                key={template.filename}
                onClick={() => this.loadTemplate(template.filename)}
            >
                {template.filename
                    .replace(EXPLORER_FILE_SUFFIX, "")
                    .replace("-", " ")}
            </button>
        ))
    }
}
