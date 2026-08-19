import React, { useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { Row, Col, Button, Dropdown, Space } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { FaChevronDown } from "react-icons/fa";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { config, store, uiText } from "../../lib";
import { eraseCookieFromAllPaths } from "../../util/date";
import { listAvailableVisualizations } from "../../config/visualizations";

/**
 * Dropdown items for the Dashboards menu, with the two kinds of dashboard
 * separated by a rule.
 *
 * One asset's dashboard and a page spanning the whole fleet answer different
 * questions, so they read as one undifferentiated list only by accident. The
 * split needs no new config: `cross_asset` already marks exactly that boundary,
 * so a future fleet-wide page joins the first group on its own. The divider is
 * dropped when either group is empty, rather than opening or closing the menu
 * with a stray line.
 *
 * The fleet-wide pages lead. They are where you start — what the country looks
 * like, what needs attention, what was inspected — and an asset dashboard is
 * where you go once you know which asset you care about. Ordered the other way
 * the entry point sat below five pages you had to scroll past to reach it.
 *
 * @param {Array<{slug: string, name: string, cross_asset: boolean}>} dashboards
 * @param {(d: object) => React.ReactNode} renderLabel
 */
export const buildDashboardMenu = (dashboards = [], renderLabel) => {
  const perAsset = dashboards.filter((d) => !d.cross_asset);
  const crossAsset = dashboards.filter((d) => d.cross_asset);
  const toItem = (d) => ({ key: d.slug, label: renderLabel(d) });
  const groups = [crossAsset, perAsset].filter((group) => group.length > 0);
  return groups.flatMap((group, index) => [
    ...(index > 0 ? [{ type: "divider", key: `divider-${index}` }] : []),
    ...group.map(toItem),
  ]);
};

const Header = ({ className = "header", ...props }) => {
  const { isLoggedIn, user } = store.useState();
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = store.useState((s) => s);
  const { active: activeLang } = language;
  const text = useMemo(() => {
    return uiText[activeLang];
  }, [activeLang]);
  const dashboardForms = useMemo(
    () => listAvailableVisualizations((window?.forms || []).map((f) => f.id)),
    []
  );
  const showDashboardsMenu =
    location.pathname.startsWith("/control-center") ||
    location.pathname.startsWith("/dashboard");

  const signOut = useCallback(async () => {
    eraseCookieFromAllPaths("AUTH_TOKEN");
    store.update((s) => {
      s.isLoggedIn = false;
      s.user = null;
    });
    navigate("login");
  }, [navigate]);

  const accessUserMenu = useMemo(() => {
    const userMenu = [
      {
        key: "controlCenter",
        label: (
          <Link
            key="controlCenter"
            className="usermenu-menu-item"
            to="/control-center"
          >
            {text?.controlCenter}
          </Link>
        ),
      },
      {
        key: "profile",
        label: (
          <Link
            key="profile"
            className="usermenu-menu-item"
            to="/control-center/profile"
          >
            {text?.myProfile}
          </Link>
        ),
      },
      {
        key: "signOut",
        danger: true,
        label: (
          <a
            key="signOut"
            className="usermenu-menu-item"
            onClick={() => {
              signOut();
            }}
          >
            {text?.signOut}
          </a>
        ),
      },
    ];
    return userMenu;
  }, [text, signOut]);

  const DashboardMenu = useMemo(
    () =>
      buildDashboardMenu(dashboardForms, (d) => (
        <Link
          key={d.slug}
          to={`/dashboard/${d.slug}`}
          className="dropdown-menu-item"
        >
          {d.name}
        </Link>
      )),
    [dashboardForms]
  );

  return (
    <Row
      className={className}
      align="middle"
      justify="space-between"
      {...props}
    >
      <Col>
        <div className="logo">
          <Link to="/">
            <div className="logo-wrapper">
              <img
                className="small-logo"
                src={config.siteLogo}
                alt={config.siteLogo}
              />
            </div>
          </Link>
        </div>
      </Col>
      {!location.pathname.includes("/report/") && (
        <Col>
          {showDashboardsMenu && dashboardForms.length > 0 && (
            <div className="navigation">
              <Space>
                <Dropdown menu={{ items: DashboardMenu }}>
                  <a
                    className="ant-dropdown-link"
                    onClick={(e) => {
                      e.preventDefault();
                    }}
                  >
                    {text?.dashboards}
                    <FaChevronDown />
                  </a>
                </Dropdown>
              </Space>
            </div>
          )}
          <div className="account">
            {isLoggedIn ? (
              <Dropdown menu={{ items: accessUserMenu }}>
                <a
                  className="ant-dropdown-link"
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                >
                  {user?.name || ""}
                  <span className="icon">
                    <UserOutlined />
                  </span>
                </a>
              </Dropdown>
            ) : (
              <Link to={"/login"}>
                <Button type="primary" shape="round">
                  {text?.login}
                </Button>
              </Link>
            )}
          </div>
        </Col>
      )}
    </Row>
  );
};

Header.propTypes = {
  className: PropTypes.string,
};

export default Header;
