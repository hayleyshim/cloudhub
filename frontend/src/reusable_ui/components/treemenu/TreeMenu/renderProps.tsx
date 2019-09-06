import React from 'react'
import classNames from 'classnames'

import { Item } from './walk'

const DEFAULT_PADDING = 0.75
const ICON_SIZE = 2
const LEVEL_SPACE = 1.75
const ToggleIcon = ({ on }: { on: boolean }) => (
  <div role="img" aria-label="Toggle" className="toggle-icon-symbol">
    {on ? '-' : '+'}
  </div>
)

export interface TreeMenuItem extends Item {
  active?: boolean
  onClick: (event: React.MouseEvent<HTMLLIElement>) => void
  toggleNode?: () => void
}

export type TreeMenuChildren = (
  props: {
    search?: (term: string) => void
    searchTerm?: string
    items: TreeMenuItem[]
    reset?: (openNodes?: string[]) => void
  }
) => JSX.Element

export const ItemComponent: React.FunctionComponent<TreeMenuItem> = ({
  hasNodes = false,
  isOpen = false,
  level = 0,
  onClick,
  toggleNode,
  active,
  focused,
  key,
  label = 'unknown',
  style = {},
}) => (
    <li
      className={classNames(
        'tree-item',
        { 'tree-item--active': active },
        { 'tree-item--focused': focused },
        `${'tree-item-level-' + level}`
      )}
      style={{
        paddingLeft: `${DEFAULT_PADDING +
          ICON_SIZE * (hasNodes ? 0 : 1) +
          level * LEVEL_SPACE}rem`,
        ...style,
      }}
      role="button"
      aria-pressed={active}
      key={key}
      onClick={onClick}
    >
      {hasNodes && (
        <div
          className="toggle-icon"
          onClick={e => {
            hasNodes && toggleNode && toggleNode()
            e.stopPropagation()
          }}
        >
          <ToggleIcon on={isOpen} />
        </div>
      )}
      {label}
    </li>
  )

export const defaultChildren: TreeMenuChildren = ({ search, items }) => {
  const onSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target
    search && search(value)
  }
  return (
    <>
      {search && (
        <input
          className="tree-search"
          aria-label="Filter"
          type="search"
          placeholder="Filter by Name..."
          onChange={onSearch}
        />
      )}
      <ul className="tree-item-group">
        {items.map(props => <ItemComponent {...props} />)}
      </ul>
    </>
  )
}
