import React from "react"
import { RelatedChart } from "@ourworldindata/utils"

export const ChartListItemVariant = ({ chart }: { chart: RelatedChart }) => {
    return (
        <li>
            <a href={`/grapher/${chart.slug}`}>{chart.title}</a>
            {chart.variantName ? (
                <span className="variantName">{chart.variantName}</span>
            ) : null}
        </li>
    )
}
