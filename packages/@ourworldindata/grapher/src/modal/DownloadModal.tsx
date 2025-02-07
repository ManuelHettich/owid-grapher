import React from "react"
import { observable, computed, action } from "mobx"
import { observer } from "mobx-react"
import {
    Bounds,
    DEFAULT_BOUNDS,
    isEmpty,
    triggerDownloadFromBlob,
    triggerDownloadFromUrl,
} from "@ourworldindata/utils"
import {
    MarkdownTextWrap,
    sumTextWrapHeights,
} from "@ourworldindata/components"
import { LoadingIndicator } from "../loadingIndicator/LoadingIndicator"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome/index.js"
import { faDownload, faInfoCircle } from "@fortawesome/free-solid-svg-icons"
import {
    BlankOwidTable,
    OwidTable,
    OwidColumnDef,
    CoreColumn,
} from "@ourworldindata/core-table"
import { STATIC_EXPORT_DETAIL_SPACING } from "../core/GrapherConstants"
import { Modal } from "./Modal"
import { Checkbox } from "../controls/Checkbox"

export interface DownloadModalManager {
    idealBounds?: Bounds
    staticSVG: string
    displaySlug: string
    baseUrl?: string
    queryStr?: string
    table?: OwidTable
    externalCsvLink?: string // Todo: we can ditch this once rootTable === externalCsv (currently not quite the case for Covid Explorer)
    shouldIncludeDetailsInStaticExport?: boolean
    detailRenderers: MarkdownTextWrap[]
    isDownloadModalOpen?: boolean
    tabBounds?: Bounds
    isOnChartOrMapTab?: boolean
    framePaddingVertical?: number
}

interface DownloadModalProps {
    manager: DownloadModalManager
}

@observer
export class DownloadModal extends React.Component<DownloadModalProps> {
    @computed private get idealBounds(): Bounds {
        return this.manager.idealBounds ?? DEFAULT_BOUNDS
    }

    @computed private get tabBounds(): Bounds {
        return this.manager.tabBounds ?? DEFAULT_BOUNDS
    }

    @computed private get modalBounds(): Bounds {
        const maxWidth = 640
        const padWidth = Math.max(16, (this.tabBounds.width - maxWidth) / 2)
        return this.tabBounds.padHeight(16).padWidth(padWidth)
    }

    @computed private get targetWidth(): number {
        return this.idealBounds.width
    }

    @computed private get targetHeight(): number {
        if (
            this.manager.shouldIncludeDetailsInStaticExport &&
            !isEmpty(this.manager.detailRenderers)
        ) {
            return (
                this.idealBounds.height +
                2 * this.manager.framePaddingVertical! +
                sumTextWrapHeights(
                    this.manager.detailRenderers,
                    STATIC_EXPORT_DETAIL_SPACING
                )
            )
        }
        return this.idealBounds.height
    }

    @computed private get manager(): DownloadModalManager {
        return this.props.manager
    }

    @observable private svgBlob?: Blob
    @observable private svgPreviewUrl?: string

    @observable private pngBlob?: Blob
    @observable private pngPreviewUrl?: string

    @observable private isReady: boolean = false

    @action.bound private export(): void {
        this.createSvg()
        const reader = new FileReader()
        reader.onload = (ev: any): void => {
            this.svgPreviewUrl = ev.target.result as string
            this.tryCreatePng(this.svgPreviewUrl)
        }
        reader.readAsDataURL(this.svgBlob as Blob)
    }

    @action.bound private createSvg(): void {
        const staticSVG = this.manager.staticSVG
        this.svgBlob = new Blob([staticSVG], {
            type: "image/svg+xml;charset=utf-8",
        })
    }

    @action.bound private tryCreatePng(svgPreviewUrl: string): void {
        const { targetWidth, targetHeight } = this
        // Client-side SVG => PNG export. Somewhat experimental, so there's a lot of cross-browser fiddling and fallbacks here.
        const img = new Image()
        img.onload = (): void => {
            try {
                const canvas = document.createElement("canvas")
                // We draw the chart at 4x res then scale it down again -- much better text quality
                canvas.width = targetWidth * 4
                canvas.height = targetHeight * 4
                const ctx = canvas.getContext("2d", {
                    alpha: false,
                }) as CanvasRenderingContext2D
                ctx.imageSmoothingEnabled = false
                ctx.setTransform(4, 0, 0, 4, 0, 0)
                ctx.drawImage(img, 0, 0)
                this.pngPreviewUrl = canvas.toDataURL("image/png")
                canvas.toBlob((blob) => {
                    this.pngBlob = blob ?? undefined
                    this.markAsReady()
                })
            } catch (e) {
                console.error(e)
                this.markAsReady()
            }
        }
        img.onerror = (err): void => {
            console.error(JSON.stringify(err))
            this.markAsReady()
        }
        img.src = svgPreviewUrl
    }

    @computed private get csvBlob(): Blob {
        const csv = this.inputTable.toPrettyCsv()
        return new Blob([csv], {
            type: "text/csv;charset=utf-8",
        })
    }

    @action.bound private markAsReady(): void {
        this.isReady = true
    }

    @computed private get fallbackPngUrl(): string {
        return `${this.manager.baseUrl || ""}.png${this.manager.queryStr || ""}`
    }
    @computed private get baseFilename(): string {
        return this.manager.displaySlug
    }

    @computed private get inputTable(): OwidTable {
        return this.manager.table ?? BlankOwidTable()
    }

    @computed private get nonRedistributableColumn(): CoreColumn | undefined {
        return this.inputTable.columnsAsArray.find(
            (col) => (col.def as OwidColumnDef).nonRedistributable
        )
    }

    // Data downloads are fully disabled if _any_ variable used is non-redistributable.
    // In the future, we would probably like to drop only the columns that are
    // non-redistributable, and allow downloading the rest in the CSV.
    // -@danielgavrilov, 2021-11-16
    @computed private get nonRedistributable(): boolean {
        return this.nonRedistributableColumn !== undefined
    }

    // There could be multiple non-redistributable variables in the chart.
    // For now, we only pick the first one to populate the link.
    // In the future, we may need to change the phrasing of the download
    // notice and provide links to all publishers.
    // -@danielgavrilov, 2021-11-16
    @computed private get nonRedistributableSourceLink(): string | undefined {
        const def = this.nonRedistributableColumn?.def as
            | OwidColumnDef
            | undefined
        return def?.sourceLink
    }

    @action.bound private onPngDownload(): void {
        const filename = this.baseFilename + ".png"
        if (this.pngBlob) {
            triggerDownloadFromBlob(filename, this.pngBlob)
        } else {
            triggerDownloadFromUrl(filename, this.fallbackPngUrl)
        }
    }

    @action.bound private onSvgDownload(): void {
        const filename = this.baseFilename + ".svg"
        if (this.svgBlob) {
            triggerDownloadFromBlob(filename, this.svgBlob)
        }
    }

    @action.bound private onCsvDownload(): void {
        const { manager, baseFilename } = this
        const filename = baseFilename + ".csv"
        if (manager.externalCsvLink) {
            triggerDownloadFromUrl(filename, manager.externalCsvLink)
        } else {
            triggerDownloadFromBlob(filename, this.csvBlob)
        }
    }

    private renderReady(): JSX.Element {
        const { manager, svgPreviewUrl, tabBounds, targetWidth, targetHeight } =
            this
        const pngPreviewUrl = this.pngPreviewUrl || this.fallbackPngUrl

        let previewWidth: number
        let previewHeight: number
        const boundScalar = 0.17
        if (tabBounds.width / tabBounds.height > targetWidth / targetHeight) {
            previewHeight = Math.min(72, tabBounds.height * boundScalar)
            previewWidth = (targetWidth / targetHeight) * previewHeight
        } else {
            previewWidth = Math.min(102, tabBounds.width * boundScalar)
            previewHeight = (targetHeight / targetWidth) * previewWidth
        }

        const imgStyle = {
            minWidth: previewWidth,
            minHeight: previewHeight,
            maxWidth: previewWidth,
            maxHeight: previewHeight,
            opacity: this.isReady ? 1 : 0,
        }

        return (
            <div className="grouped-menu">
                {manager.isOnChartOrMapTab && (
                    <div className="grouped-menu-section">
                        <h2>Visualization</h2>
                        <div className="grouped-menu-list">
                            <button
                                className="grouped-menu-item"
                                onClick={this.onPngDownload}
                                data-track-note="chart_download_png"
                            >
                                <div className="grouped-menu-icon">
                                    <img src={pngPreviewUrl} style={imgStyle} />
                                </div>
                                <div className="grouped-menu-content">
                                    <h3 className="title">Image (PNG)</h3>
                                    <p className="description">
                                        Suitable for most uses, widely
                                        compatible.
                                    </p>
                                </div>
                                <div className="grouped-menu-icon">
                                    <span className="download-icon">
                                        <FontAwesomeIcon icon={faDownload} />
                                    </span>
                                </div>
                            </button>
                            <button
                                className="grouped-menu-item"
                                onClick={this.onSvgDownload}
                                data-track-note="chart_download_svg"
                            >
                                <div className="grouped-menu-icon">
                                    <img src={svgPreviewUrl} style={imgStyle} />
                                </div>
                                <div className="grouped-menu-content">
                                    <h3 className="title">
                                        Vector graphic (SVG)
                                    </h3>
                                    <p className="description">
                                        For high quality prints, or further
                                        editing the chart in graphics software.
                                    </p>
                                </div>
                                <div className="grouped-menu-icon">
                                    <span className="download-icon">
                                        <FontAwesomeIcon icon={faDownload} />
                                    </span>
                                </div>
                            </button>
                        </div>
                        {!isEmpty(this.manager.detailRenderers) && (
                            <div className="static-exports-options">
                                <Checkbox
                                    checked={
                                        !!this.manager
                                            .shouldIncludeDetailsInStaticExport
                                    }
                                    label="Include terminology definitions at bottom of chart"
                                    onChange={(): void => {
                                        this.isReady = false
                                        this.manager.shouldIncludeDetailsInStaticExport =
                                            !this.manager
                                                .shouldIncludeDetailsInStaticExport
                                        this.export()
                                    }}
                                />
                            </div>
                        )}
                    </div>
                )}
                <div className="grouped-menu-section grouped-menu-section-data">
                    <h2>Data</h2>
                    {this.nonRedistributable ? (
                        <div className="grouped-menu-callout">
                            <div className="grouped-menu-callout-content">
                                <h3 className="title">
                                    <FontAwesomeIcon icon={faInfoCircle} />
                                    The data in this chart is not available to
                                    download
                                </h3>
                                <p>
                                    The data is published under a license that
                                    doesn't allow us to redistribute it.
                                    {this.nonRedistributableSourceLink && (
                                        <>
                                            {" "}
                                            Please visit the{" "}
                                            <a
                                                href={
                                                    this
                                                        .nonRedistributableSourceLink
                                                }
                                            >
                                                data publisher's website
                                            </a>{" "}
                                            for more details.
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="grouped-menu-list">
                            <button
                                className="grouped-menu-item"
                                onClick={this.onCsvDownload}
                                data-track-note="chart_download_csv"
                            >
                                <div className="grouped-menu-content">
                                    <h3 className="title">Full data (CSV)</h3>
                                    <p className="description">
                                        The full dataset used in this chart.
                                    </p>
                                </div>
                                <div className="grouped-menu-icon">
                                    <span className="download-icon">
                                        <FontAwesomeIcon icon={faDownload} />
                                    </span>
                                </div>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    componentDidMount(): void {
        this.export()
    }

    render(): JSX.Element {
        return (
            <Modal
                title="Download"
                onDismiss={action(
                    () => (this.manager.isDownloadModalOpen = false)
                )}
                bounds={this.modalBounds}
            >
                <div className="DownloadModalContent">
                    {this.isReady ? (
                        this.renderReady()
                    ) : (
                        <LoadingIndicator color="#000" />
                    )}
                </div>
            </Modal>
        )
    }
}
